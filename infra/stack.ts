import path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import { APP_SLUG } from '../apps/showcase/config/app'
import { addTags, TAGS } from './lib/tags'

const { aws_budgets, aws_cloudfront, aws_cloudfront_origins, aws_ec2, aws_lambda, aws_lambda_nodejs, aws_rds, aws_s3 } =
    cdk

const ENVIRONMENTS = ['Staging', 'Production'] as const
type Environment = (typeof ENVIRONMENTS)[number]

/**
 * DRAFT application stack (ADR-0001): Next `output: 'standalone'` server in one Lambda behind the
 * AWS Lambda Web Adapter layer, Function URL origin behind CloudFront, static assets from S3, a
 * migrator NodejsFunction sharing the app's migration code, Aurora PostgreSQL Serverless v2
 * (min 0 in non-prod).
 *
 * Gates before any deploy (docs/cutover-checklist.md): `cloud-accounts` (fills config/params.ts) and
 * `recurring-cost` (Aurora, NAT gateway, CloudFront must be approved). Not a checklist row, but do it
 * before the first deploy: if your organisation ships its own CDK construct library, replace
 * lib/tags.ts and the IAM/secrets/monitoring drafts with it. Deploys run through your own pipeline, not GitHub Actions — see infra/README.md.
 */
export class AppStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        const environment = this.node.tryGetContext('environment') as Environment | undefined
        if (!environment || !ENVIRONMENTS.includes(environment)) {
            throw new Error(`context "environment" must be one of ${ENVIRONMENTS.join(', ')}`)
        }
        const isProd = environment === 'Production'
        addTags(this, { ...TAGS, Environment: environment })

        // ---- networking -------------------------------------------------------------------
        // One NAT gateway so the in-VPC Lambda can reach the hosted auth/email/LLM services —
        // recurring cost, gated by cutover row `recurring-cost`.
        const vpc = new aws_ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            natGateways: 1,
        })

        // ---- database ---------------------------------------------------------------------
        const db = new aws_rds.DatabaseCluster(this, 'Db', {
            engine: aws_rds.DatabaseClusterEngine.auroraPostgres({
                version: aws_rds.AuroraPostgresEngineVersion.VER_16_10,
            }),
            writer: aws_rds.ClusterInstance.serverlessV2('writer'),
            serverlessV2MinCapacity: isProd ? 1 : 0,
            serverlessV2MaxCapacity: 2,
            vpc,
            vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
            defaultDatabaseName: APP_SLUG,
            storageEncrypted: true,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        })

        // ---- buckets ----------------------------------------------------------------------
        // CDN-served build assets — written by the deploy pipeline only.
        const assetsBucket = new aws_s3.Bucket(this, 'AssetsBucket', {
            blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: !isProd,
        })
        // App object storage (StoragePort) — private, NEVER behind CloudFront: sharing the CDN
        // bucket would make app-stored objects publicly fetchable and let the app overwrite
        // served JS.
        const storageBucket = new aws_s3.Bucket(this, 'StorageBucket', {
            blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: aws_s3.BucketEncryption.S3_MANAGED,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: !isProd,
        })

        // ---- app server lambda (web adapter) -----------------------------------------------
        // Code ships as the standalone build zip uploaded by your deploy pipeline — the committed
        // placeholder asset keeps synth honest until then.
        const serverFn = new aws_lambda.Function(this, 'Server', {
            runtime: aws_lambda.Runtime.NODEJS_22_X,
            architecture: aws_lambda.Architecture.X86_64,
            code: aws_lambda.Code.fromAsset(path.join(__dirname, 'assets/placeholder-lambda')),
            handler: 'run.sh',
            memorySize: 1769, // 1 vCPU-second per second — the sweet spot for SSR cold starts
            timeout: cdk.Duration.seconds(30),
            vpc,
            vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
            layers: [
                aws_lambda.LayerVersion.fromLayerVersionArn(
                    this,
                    'WebAdapterLayer',
                    // AWS-published public layer
                    `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:24`,
                ),
            ],
            environment: {
                AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
                PORT: '3000',
                APP_MODE: 'real',
                NEXT_TELEMETRY_DISABLED: '1',
                // DRAFT: built via CFN dynamic references so the server
                // can actually boot; revisit with the shared secrets constructs at cutover
                // (env-var exposure vs runtime secret fetch).
                DATABASE_URL: `postgres://${db.secret!.secretValueFromJson('username').unsafeUnwrap()}:${db
                    .secret!.secretValueFromJson('password')
                    .unsafeUnwrap()}@${db.clusterEndpoint.socketAddress}/${APP_SLUG}`,
                STORAGE_BUCKET: storageBucket.bucketName,
            },
        })
        db.secret!.grantRead(serverFn)
        db.connections.allowDefaultPortFrom(serverFn)
        storageBucket.grantReadWrite(serverFn)

        // AWS_IAM, not NONE. A Function URL with NONE answers anyone on the internet who has the URL,
        // and putting CloudFront in front of it does not change that — the origin stays directly
        // reachable, so any WAF, geo restriction, rate limit or response-headers policy attached to
        // the distribution later is bypassable by calling the origin instead. Paired with the origin
        // access control below, the distribution is the only caller that can sign a request.
        const functionUrl = serverFn.addFunctionUrl({ authType: aws_lambda.FunctionUrlAuthType.AWS_IAM })

        // ---- migrator ----------------------------------------------------------------------
        // Bundles the SAME migration registry the app and tests use
        // (packages/keel/src/db/migrations, composed with the app's ≥1001 set through the seam).
        // The entry is one of keel's published subpaths (packages/keel/package.json `exports`) —
        // spelled as a path here because CDK bundling needs a file, not a specifier.
        const migrator = new aws_lambda_nodejs.NodejsFunction(this, 'Migrator', {
            runtime: aws_lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../packages/keel/src/adapters/real/migrate-handler.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            vpc,
            vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
            environment: { DB_SECRET_ARN: db.secret!.secretArn },
            bundling: {
                tsconfig: path.join(__dirname, '../tsconfig.json'),
                format: aws_lambda_nodejs.OutputFormat.ESM,
                // pg's optional native/cloudflare shims must stay external or esbuild chokes
                externalModules: ['@aws-sdk/*', 'pg-native', 'cloudflare:sockets'],
            },
        })
        db.secret!.grantRead(migrator)
        db.connections.allowDefaultPortFrom(migrator)

        // ---- cloudfront ---------------------------------------------------------------------
        // First deploys ride *.cloudfront.net; custom domains + certs are cutover row
        // `domains-and-certs`.
        const distribution = new aws_cloudfront.Distribution(this, 'Distribution', {
            defaultBehavior: {
                // withOriginAccessControl, not the plain constructor: it creates the OAC and grants
                // this distribution — and only this distribution — permission to invoke the URL.
                origin: aws_cloudfront_origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),
                viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: aws_cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            },
            additionalBehaviors: {
                '/_next/static/*': {
                    origin: aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
                    cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
                },
                '/assets/*': {
                    origin: aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
                    cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
                },
            },
        })

        // ---- scheduled-work tick (cutover `scheduled-tick`) ------------------------------
        // The scheduled-jobs due-scan is driven by an EventBridge Scheduler schedule
        // POSTing `/api/webhooks/cron` on a fixed cadence with `Authorization: Bearer $WEBHOOK_SECRET`
        // (the same shared secret as `job-runner`). It is NOT authored here on purpose: the only
        // clean primitive for "POST an arbitrary HTTPS URL with an auth header" is an EventBridge API
        // Destination + Connection, which depends on the WEBHOOK_SECRET Secrets Manager resource that
        // lands with `job-runner` — authoring it half-wired would break `cdk synth`. It rides that
        // secret; see the `scheduled-tick` cutover row for the schedule + connection + verification.

        // ---- basic alarms ---------------------------------------------------------------------
        // Draft thresholds; replaced by the shared monitoring constructs at cutover.
        new cdk.aws_cloudwatch.Alarm(this, 'ServerErrorsAlarm', {
            metric: serverFn.metricErrors({ period: cdk.Duration.minutes(5) }),
            threshold: 5,
            evaluationPeriods: 1,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        })
        new cdk.aws_cloudwatch.Alarm(this, 'ServerThrottlesAlarm', {
            metric: serverFn.metricThrottles({ period: cdk.Duration.minutes(5) }),
            threshold: 1,
            evaluationPeriods: 1,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        })

        // ---- budget guard -------------------------------------------------------------------
        new aws_budgets.CfnBudget(this, 'Budget', {
            budget: {
                budgetName: `${APP_SLUG}-${environment.toLowerCase()}`,
                budgetType: 'COST',
                timeUnit: 'MONTHLY',
                budgetLimit: { amount: 50, unit: 'USD' },
            },
            notificationsWithSubscribers: [
                {
                    notification: {
                        notificationType: 'ACTUAL',
                        comparisonOperator: 'GREATER_THAN',
                        threshold: 80,
                    },
                    // cutover `cloud-accounts`: replace with a real alert address from config/params.ts
                    subscribers: [{ subscriptionType: 'EMAIL', address: 'PLACEHOLDER_BUDGET_ALERT_EMAIL' }],
                },
            ],
        })

        new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName })
        new cdk.CfnOutput(this, 'FunctionUrl', { value: functionUrl.url })
        new cdk.CfnOutput(this, 'DbSecretArn', { value: db.secret!.secretArn })
    }
}
