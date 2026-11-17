import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
// The runtime's own list of what each transport requires — the contract this stack must satisfy. Read
// from the module that enforces it at boot, by path (infra resolves nothing through the `keel` alias),
// so renaming a variable on either side fails here instead of at the first deploy.
import { DATABASE_ENV } from '../packages/keel/src/adapters/real/database-transport'
import { AppStack } from './stack'

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

function resources(transport: Transport): Record<string, Resource> {
    const app = new cdk.App({ context: { environment: 'Staging' } })
    const stack = new AppStack(app, `ShapeCheck-${transport}`, { databaseTransport: transport })
    return Template.fromStack(stack).toJSON().Resources as Record<string, Resource>
}

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

const idsOf = (all: Record<string, Resource>, ...types: string[]) =>
    Object.entries(all)
        .filter(([, r]) => types.includes(r.Type))
        .map(([id]) => id)

type Statement = { Action?: unknown; Resource?: unknown }

/** Every IAM policy statement in the stack whose actions name `service`'s (`rds-data:`, `secretsmanager:`). */
function grantsOf(all: Record<string, Resource>, service: string): Statement[] {
    return Object.values(all)
        .filter((r) => r.Type === 'AWS::IAM::Policy')
        .flatMap(
            (r) =>
                ((r.Properties?.PolicyDocument as { Statement?: unknown[] } | undefined)?.Statement ??
                    []) as Statement[],
        )
        .filter((s) => JSON.stringify(s.Action ?? '').includes(service))
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
    const all = resources(transport)
    const label = (what: string) => `[${transport}] ${what}`
    const [clusterId, clusterResource] = Object.entries(all).find(([, r]) => r.Type === 'AWS::RDS::DBCluster')!
    const cluster = clusterResource.Properties ?? {}
    const server = lambda(all, 'Server')
    const migrator = lambda(all, 'Migrator')

    check(server.env.DATABASE_TRANSPORT === transport, label('the server says which transport it runs'))
    check(migrator.env.DATABASE_TRANSPORT === transport, label('the migrator says which transport it runs'))

    // The database secret is read by name, on both shapes: never a wildcard, never another secret.
    const secretIds = idsOf(all, 'AWS::SecretsManager::Secret', 'AWS::SecretsManager::SecretTargetAttachment')
    const secretGrants = grantsOf(all, 'secretsmanager:')
    check(
        secretGrants.length > 0 && secretGrants.every((s) => namesOnly(s, secretIds)),
        label('every Secrets Manager grant names this database secret alone'),
    )

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
        // Every statement granting a Data API action names this cluster, and nothing wider: the grant plus the
        // secret is the whole way in on this shape.
        const dataApiGrants = grantsOf(all, 'rds-data:')
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
