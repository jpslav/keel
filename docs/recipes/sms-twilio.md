# Recipe: SMS via Twilio

keel ships the `sms` notification channel with a fake catch-store and a deliberate no-op in real
mode. This is the written-down plan for the instance-side swap — follow it when a real deployment needs
to actually send text messages. Nothing here is built; this page is the deliverable (see
`docs/development-approach.md`'s realtime-collab recipe for the precedent this one copies).

## 1. The seam is already there — implement against it

`packages/keel/src/server-lib/sms.ts` defines the whole interface:

```ts
export interface SmsMessage {
    to: string // display stand-in today — see §4
    body: string
    kind: string
    recipientUserId: string
}
export type SmsChannel = (message: SmsMessage) => Promise<void>
```

`sendSms` picks the fake in simulated mode and falls through to a no-op comment in real mode. Wiring Twilio means
replacing that real-mode branch — either inline or by dispatching to a small adapter behind it, the same shape
`dispatchWebhook` uses for `fakeDispatchWebhook`. `packages/keel/src/server-lib/notify.ts` (the fan-out)
depends only on the `SmsChannel` type, so it needs no change at all.

## 2. Where the vendor SDK goes

A new `packages/keel/src/adapters/real/sms.ts` is the only file allowed to `import 'twilio'` —
CLAUDE.md's hard rule (vendor SDKs only inside `packages/keel/src/adapters/`) and the ports-boundary lint
rule both apply here exactly as they do to `packages/keel/src/adapters/real/email.ts`. It exports
something Twilio-shaped (`send(message)` or similar) that `packages/keel/src/server-lib/sms.ts`'s real
branch calls. The fake, `packages/keel/src/adapters/fake/sms.ts`, does not move or change — it stays the
channel that `pnpm dev`, demo mode, and static demo run forever, exactly like every other port's
two-implementations split. Adding Twilio doesn't touch the fake side of this seam at all.

## 3. Cutover rows

Add a `twilio` block to `apps/showcase/config/params.ts` next to `mailgun`, following the existing shape (plain values
for non-secret identifiers, `*Name` for the name of a secret — never a secret value):

```ts
twilio: {
    // cutover: twilio-sms
    accountSidName: 'PLACEHOLDER_TWILIO_ACCOUNT_SID_NAME',
    authTokenName: 'PLACEHOLDER_TWILIO_AUTH_TOKEN_NAME',
    // one of the two, depending on whether the instance sends from a single number or a pool:
    fromNumber: 'PLACEHOLDER_TWILIO_FROM_NUMBER',
    messagingServiceSidName: 'PLACEHOLDER_TWILIO_MESSAGING_SERVICE_SID_NAME',
},
```

And a row in `docs/cutover-checklist.md`, copying the `email-outbound` row's format exactly:

| Status | Item         | What it is                                                                                                         | What unlocks it                           | Deferred verification                                                                                                                                           |
| ------ | ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜     | `twilio-sms` | Twilio account SID/auth token + a from-number or Messaging Service SID (names in `apps/showcase/config/params.ts`) | you provision a Twilio account and number | Real send through `packages/keel/src/adapters/real/sms.ts`; a live message received on a real phone; delivery-status callback handling if the instance needs it |

Secret values (auth token) never enter the repo — only the Secrets Manager entry name does, same as
`mailgun.apiKeyName` and `anthropic.apiKeyName` today.

## 4. `to` needs a real phone number

`SmsMessage.to` is documented today as "a display address for the recipient (a name/email stand-in — seed
people carry no phone)" — the seeded people have no phone field to send to. A real instance resolves
an actual E.164 number before calling `sendSms`: either from the IdP profile (a Clerk user's phone number,
if phone auth/MFA is enabled) or from an app-owned profile field the instance adds. That resolution is
instance work, not part of this seam — `sendSms` just needs a valid number by the time it's called.

## 5. Why this is a recipe, not shipped code

Run it against the two tests `docs/development-approach.md` and `docs/app-coverage-gaps.md` apply to every
candidate for template vendor code:

- **Universality** — will every instance send SMS? No. Most instances of a generic multi-tenant scaffold
  never touch a phone number; shipping Twilio by default is a maintenance bill nobody but SMS-using
  instances pays for.
- **New-class** — does it teach integration mechanics the template doesn't already demonstrate? No. Twilio
  is an outbound authenticated vendor API call — the exact class the LLM (Anthropic), email (Mailgun), and
  webhook-dispatch (`fetch` + HMAC) adapters already teach end to end. Building it in the template would be
  demonstrating that class a fourth time with a different logo, not covering new ground.

Fails both → recipe, per `docs/app-coverage-gaps.md`'s "template/instance doctrine." The fake stays the
only shipped consumer, which is what keeps the channel abstraction honest without dragging in vendor code
nobody in the template exercises.

## 6. Hermetic / static-demo note

The fake channel (`packages/keel/src/adapters/fake/sms.ts`, catching to `.data/sms/`, rendered in
Simulator's Messages tab) is what `pnpm dev`, demo mode, and the `file://` static demo run always — none of
them ever reach the real branch. The Twilio adapter only runs where `APP_MODE=real` selects it: `pnpm
dev:real` against a dev Twilio account, and deployed environments after the `twilio-sms` cutover row is done.
Until that row is checked off, real-mode SMS is authored but unverified, same as every other open row in the
checklist.
