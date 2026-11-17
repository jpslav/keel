import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
// The runtime's own list of what each transport requires — the contract this stack must satisfy. Read
// from the module that enforces it at boot, by path (infra resolves nothing through the `keel` alias),
// so renaming a variable on either side fails here instead of at the first deploy.
import { DATABASE_ENV } from '../packages/keel/src/adapters/real/database-transport'
import { APP_TSCONFIG, AppStack } from './stack'

/**
 * BOTH network shapes, synthesized and checked — `pnpm synth` runs this after `cdk synth`, and CI runs
 * `pnpm synth`. `cdk synth` alone builds only the shape the app's params choose (`pg` by default), so
 * without this the opt-in `data-api` shape, its grants and its environment would never be built by any
 * gate. Offline, like synth: nothing is deployed and no credentials are read.
 */

type Transport = keyof typeof DATABASE_ENV
type Resource = { Type: string; Properties?: Record<string, unknown> }

const problems: string[] = []
const check = (ok: boolean, message: string) => {
    if (!ok) problems.push(message)
}

/** A shape's template, and the directory its synth staged assets in (bundles included). */
function synthesize(transport: Transport): { all: Record<string, Resource>; assembly: string } {
    const app = new cdk.App({ context: { environment: 'Staging' } })
    const stack = new AppStack(app, `ShapeCheck-${transport}`, { databaseTransport: transport })
    const all = Template.fromStack(stack).toJSON().Resources as Record<string, Resource>
    return { all, assembly: app.synth().directory }
}

/**
 * The code esbuild bundled for each Lambda the stack bundles, keyed by logical id: what NodejsFunction
 * produced during this synth, with the tsconfig the stack passes, not a re-creation of it. A Lambda whose
 * code is a ready-made asset (the server's placeholder zip, CDK's own providers) has no bundle and is
 * left out.
 */
function bundles(all: Record<string, Resource>, assembly: string): Map<string, string> {
    const found = new Map<string, string>()
    for (const [id, r] of Object.entries(all)) {
        if (r.Type !== 'AWS::Lambda::Function') continue
        const key = (r.Properties?.Code as { S3Key?: unknown } | undefined)?.S3Key
        if (typeof key !== 'string') continue
        const staged = path.join(assembly, `asset.${key.replace(/\.zip$/, '')}`)
        const entry = ['index.mjs', 'index.js'].map((file) => path.join(staged, file)).find((file) => existsSync(file))
        if (entry) found.set(id, readFileSync(entry, 'utf8'))
    }
    return found
}

/** The app's own migrations, by registry name: the files beside the app seam's migration index. */
const APP_MIGRATIONS = readdirSync(path.join(path.dirname(APP_TSCONFIG), 'src/app-config/db/migrations'))
    .filter((file) => /^\d+_.+\.ts$/.test(file))
    .map((file) => file.replace(/\.ts$/, ''))

function lambda(all: Record<string, Resource>, name: 'Server' | 'Migrator') {
    const found = Object.entries(all).find(
        ([id, r]) => r.Type === 'AWS::Lambda::Function' && id.startsWith(name) && !id.includes('Provider'),
    )
    if (!found) throw new Error(`no ${name} function in the synthesized stack`)
    const props = found[1].Properties ?? {}
    const env = ((props.Environment as { Variables?: Record<string, unknown> } | undefined)?.Variables ?? {}) as Record<
        string,
        unknown
    >
    return { inVpc: props.VpcConfig !== undefined, env }
}

const count = (all: Record<string, Resource>, type: string) => Object.values(all).filter((r) => r.Type === type).length

type Statement = { Effect?: unknown; Action?: unknown; NotAction?: unknown; Resource?: unknown }

/** The permission documents a resource carries: a policy's, a managed policy's, or a role's inline ones. */
function policyDocuments(resource: Resource): unknown[] {
    if (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') {
        return [resource.Properties?.PolicyDocument]
    }
    if (resource.Type === 'AWS::IAM::Role') {
        const inline = (resource.Properties?.Policies as { PolicyDocument?: unknown }[] | undefined) ?? []
        return inline.map((policy) => policy.PolicyDocument)
    }
    return []
}

/**
 * Whether an IAM action pattern can name one of `service`'s actions. IAM matches `*` and `?` anywhere in
 * an action, so `*`, `rds-data:*` and `rds*:Execute*` all reach `rds-data:ExecuteStatement`.
 */
function reaches(action: string, service: string): boolean {
    const prefix = action.includes(':') ? action.slice(0, action.indexOf(':')) : action
    const pattern = prefix
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
    return new RegExp(`^${pattern}$`, 'i').test(service)
}

/**
 * Every Allow statement in the stack's IAM policies, managed policies and roles' inline policies that can
 * grant one of `service`'s actions (`rds-data`, `secretsmanager`): by naming one, by a wildcard that
 * reaches one (`*` reaches every service), or by `NotAction`, which grants everything it does not name.
 * Roles' trust policies grant nothing and are not read.
 */
function grantsOf(all: Record<string, Resource>, service: string): Statement[] {
    return Object.values(all)
        .flatMap(policyDocuments)
        .flatMap((document) => ((document as { Statement?: unknown[] } | undefined)?.Statement ?? []) as Statement[])
        .filter((s) => s.Effect !== 'Deny')
        .filter((s) => {
            if (s.NotAction !== undefined) return true
            const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
            return actions.some((action) => typeof action === 'string' && reaches(action, service))
        })
}

/**
 * The AWS-managed policies a role may attach: the check cannot read their contents, so it allows only the
 * two Lambda execution policies CDK attaches (logs, and network interfaces on `pg`), which grant neither
 * service. A managed policy defined in the stack is read like any other (grantsOf).
 */
const KNOWN_AWS_POLICIES = ['service-role/AWSLambdaBasicExecutionRole', 'service-role/AWSLambdaVPCAccessExecutionRole']

function unreadablePolicies(all: Record<string, Resource>): string[] {
    const inStack = new Set(
        Object.entries(all)
            .filter(([, r]) => r.Type === 'AWS::IAM::ManagedPolicy')
            .map(([id]) => id),
    )
    return Object.entries(all)
        .filter(([, r]) => r.Type === 'AWS::IAM::Role')
        .flatMap(([id, r]) =>
            ((r.Properties?.ManagedPolicyArns as unknown[] | undefined) ?? [])
                .filter((arn) => {
                    const text = JSON.stringify(arn)
                    const ref = (arn as { Ref?: string }).Ref
                    if (ref !== undefined && inStack.has(ref)) return false
                    return !KNOWN_AWS_POLICIES.some((name) =>
                        new RegExp(`:iam::aws:policy/${name}"[\\]}]*$`).test(text),
                    )
                })
                .map((arn) => `${id}: ${JSON.stringify(arn)}`),
        )
}

/** The cluster's own secret: the attachment CDK makes for the cluster, and the secret it attaches. */
function databaseSecretIds(all: Record<string, Resource>, clusterId: string): string[] {
    return Object.entries(all)
        .filter(
            ([, r]) =>
                r.Type === 'AWS::SecretsManager::SecretTargetAttachment' &&
                JSON.stringify(r.Properties?.TargetId) === JSON.stringify({ Ref: clusterId }),
        )
        .flatMap(([id, r]) => {
            const secret = (r.Properties?.SecretId as { Ref?: string } | undefined)?.Ref
            return secret ? [id, secret] : [id]
        })
}

/** Whether every resource `statement` grants refers to one of `ids`, and none is a wildcard. */
function namesOnly(statement: Statement, ids: readonly string[]): boolean {
    const granted = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource ?? '*']
    return granted.every((resource) => {
        const text = JSON.stringify(resource)
        return !text.includes('*') && ids.some((id) => text.includes(`"Ref":"${id}"`))
    })
}

for (const transport of ['pg', 'data-api'] as const) {
    const { all, assembly } = synthesize(transport)
    const label = (what: string) => `[${transport}] ${what}`
    const [clusterId, clusterResource] = Object.entries(all).find(([, r]) => r.Type === 'AWS::RDS::DBCluster')!
    const cluster = clusterResource.Properties ?? {}
    const server = lambda(all, 'Server')
    const migrator = lambda(all, 'Migrator')

    check(server.env.DATABASE_TRANSPORT === transport, label('the server says which transport it runs'))
    check(migrator.env.DATABASE_TRANSPORT === transport, label('the migrator says which transport it runs'))

    // The database secret is read by name, on both shapes: never a wildcard, never another secret.
    const secretIds = databaseSecretIds(all, clusterId)
    const secretGrants = grantsOf(all, 'secretsmanager')
    check(
        secretIds.length > 0 && secretGrants.length > 0 && secretGrants.every((s) => namesOnly(s, secretIds)),
        label('every Secrets Manager grant names the cluster’s own secret alone'),
    )
    const unreadable = unreadablePolicies(all)
    check(
        unreadable.length === 0,
        label(`no role attaches an AWS-managed policy the check cannot read: ${unreadable.join('; ')}`),
    )

    // Encrypted at rest, on both shapes. An Aurora instance takes its encryption from its cluster, so the
    // cluster is what is checked.
    const clusters = Object.values(all).filter((r) => r.Type === 'AWS::RDS::DBCluster')
    check(
        clusters.length > 0 && clusters.every((r) => r.Properties?.StorageEncrypted === true),
        label('every database cluster is encrypted at rest (StorageEncrypted)'),
    )

    // What each bundled Lambda really contains. The tsconfig it is built with decides where
    // `@app-config/*` resolves: to the app's seam, never to keel's test fixture.
    const built = bundles(all, assembly)
    for (const [id, code] of built) {
        check(!code.includes('test-fixture'), label(`${id}'s bundle holds no code from packages/keel/test-fixture`))
    }
    const migratorCode = [...built].find(([id]) => id.startsWith('Migrator'))?.[1]
    check(migratorCode !== undefined, label('the migrator is bundled by this synth'))
    for (const name of APP_MIGRATIONS) {
        check(
            migratorCode?.includes(`"${name}"`) === true,
            label(`the migrator's bundle carries the app's migration ${name}`),
        )
    }
    rmSync(assembly, { recursive: true, force: true })

    if (transport === 'data-api') {
        for (const name of Object.keys(DATABASE_ENV['data-api'])) {
            check(name in server.env, label(`the server sets ${name}, which the runtime requires`))
            check(name in migrator.env, label(`the migrator sets ${name}, which it requires`))
        }
        check(!('DATABASE_URL' in server.env), label('no DATABASE_URL: the credential stays in Secrets Manager'))
        check(!('DATABASE_URL' in migrator.env), label('no DATABASE_URL on the migrator either'))
        check(!server.inVpc && !migrator.inVpc, label('both Lambdas run outside the VPC'))
        check(cluster.EnableHttpEndpoint === true, label('the cluster has the Data API enabled'))
        check(count(all, 'AWS::EC2::NatGateway') === 0, label('no NAT gateway'))
        check(count(all, 'AWS::EC2::InternetGateway') === 0, label('no internet gateway'))
        // Every statement that can grant a Data API action (see grantsOf) names this cluster, and nothing
        // wider: the grant plus the secret is the whole way in on this shape.
        const dataApiGrants = grantsOf(all, 'rds-data')
        check(
            dataApiGrants.some((s) => JSON.stringify(s.Action).includes('rds-data:ExecuteStatement')),
            label('a role is granted rds-data:ExecuteStatement'),
        )
        check(
            dataApiGrants.every((s) => namesOnly(s, [clusterId])),
            label('every rds-data grant is scoped to this cluster alone'),
        )
        // Nothing reaches the database over the network on this shape: its security group admits nobody.
        const dbGroups = JSON.stringify(cluster.VpcSecurityGroupIds ?? [])
        const ingress = Object.entries(all).filter(
            ([id, r]) =>
                (r.Type === 'AWS::EC2::SecurityGroupIngress' &&
                    dbGroups.includes(JSON.stringify(r.Properties?.GroupId ?? null))) ||
                (r.Type === 'AWS::EC2::SecurityGroup' &&
                    dbGroups.includes(`"${id}"`) &&
                    ((r.Properties?.SecurityGroupIngress as unknown[] | undefined) ?? []).length > 0),
        )
        check(ingress.length === 0, label('the database security group admits no inbound traffic'))
    } else {
        for (const name of Object.keys(DATABASE_ENV.pg)) {
            check(name in server.env, label(`the server sets ${name}, which the runtime requires`))
        }
        check('DB_SECRET_ARN' in migrator.env, label('the migrator gets the secret it builds its connection from'))
        check(server.inVpc && migrator.inVpc, label('both Lambdas run inside the VPC'))
        check(!('EnableHttpEndpoint' in cluster), label('the pg cluster leaves the Data API unset, as before'))
        check(count(all, 'AWS::EC2::NatGateway') === 1, label('one NAT gateway for the Lambdas’ egress'))
    }
}

if (problems.length > 0) {
    console.error(`infra shape check failed:\n  ${problems.join('\n  ')}`)
    process.exit(1)
}
console.log('infra shape check: both network shapes match the runtime contract')
