import * as cdk from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import { APP_SLUG } from '../../apps/showcase/config/app'

/**
 * The mandatory-tag pattern: one map applied to EVERY construct in the stack (`addTags` below), so
 * no resource can be created without answering the questions the organisation asks of it.
 *
 * The first three keys are near-universal — what this is (`Name`, `Application`) and who answers for
 * it (`Owner`); `Environment` is the fourth, added per stack in `../stack.ts` because only the stack
 * knows which deployment it is. Keep those.
 *
 * The classification keys below are an EXAMPLE of the other half of the pattern — the governance
 * taxonomy an organisation mandates so its estate can be queried by sensitivity, criticality and
 * blast radius. Every organisation's is different: REPLACE them with your own policy's keys (or drop
 * them if you have none), and if your organisation ships shared CDK constructs for tagging, import
 * those instead of this file. `TEMPLATE-UPDATE-ME` is a deliberate tripwire — it synths and deploys,
 * and stays obvious in the console until someone fills it in.
 */
export const TAGS = {
    Name: APP_SLUG,
    Application: APP_SLUG,
    Owner: 'TEMPLATE-UPDATE-ME',
    // Example governance taxonomy — replace these four keys with your own organisation's.
    AssetClassification: 'TEMPLATE-UPDATE-ME',
    DataClassification: 'TEMPLATE-UPDATE-ME',
    MissionCriticality: 'TEMPLATE-UPDATE-ME',
    AccessLevel: 'TEMPLATE-UPDATE-ME',
} as const

export function addTags(scope: Construct, tags: Record<string, string>): void {
    for (const [key, value] of Object.entries(tags)) {
        cdk.Tags.of(scope).add(key, value)
    }
}
