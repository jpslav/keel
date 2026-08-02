---
description: Add an outbound webhook event kind registered through the app-config seam
---

Add an outbound webhook event kind for: $ARGUMENTS

Outbound webhooks (endpoints CRUD, signed delivery, retries/backoff, the Simulator Hooks tab) are
framework; event kinds are vocabulary you register:

1. **Register** in `apps/showcase/src/app-config/webhooks.ts`: add the kind to `appWebhookEventKinds`
   (`<entity>.<event>`) and its payload shape to `AppWebhookEventPayloadMap`. Payloads are the signed
   envelope's `data` — keep them small, stable, and id-bearing (consumers dedupe on the delivery id).
2. **Emit** via `enqueueWebhookEvent` (`packages/keel/src/db/webhooks.ts`) at the mutation choke point, after the
   write commits — `escalation.created`/`escalation.decided` in the escalations routes are the
   worked examples. Delivery is at-least-once; the drain does the network effect on the next tick.
3. **Signature headers** derive from `APP_SLUG` (`WEBHOOK_*_HEADER` in `packages/keel/src/core/webhook-signing.ts`)
   — never hard-code them; receivers pin these names at integration time.
4. **Test**: emit → drain → caught delivery with a verifying signature, following
   `packages/keel/src/db/webhooks.test.ts`; inspect it in the Simulator Hooks tab (failure toggle exercises the
   retry path); mirror in the static twin if the demo world emits it. Finish with `pnpm verify`.
