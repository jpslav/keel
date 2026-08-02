import * as cdk from 'aws-cdk-lib'
// Infra deploys ONE app; it names the one this repo ships (ADR-0007 — the apps/ tree). An adopter
// with a different app repoints these imports at their own `apps/<app>/config/app`.
import { APP_SLUG } from '../apps/showcase/config/app'
import { AppStack } from './stack'

/**
 * Entry point. Environment-agnostic until cutover (`cloud-accounts`) fills config/params.ts — no
 * account/region is bound, so `pnpm synth` runs offline with zero credentials.
 */
const app = new cdk.App()

// Stack id derives from the app slug (capitalized) so two apps in one AWS account never collide.
const stackId = `${APP_SLUG.charAt(0).toUpperCase()}${APP_SLUG.slice(1)}AppStack`

new AppStack(app, stackId, {
    description: `${APP_SLUG} application stack (Next standalone on Lambda via Web Adapter, ADR-0001)`,
})

app.synth()
