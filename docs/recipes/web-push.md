# Recipe: web-push browser notifications

keel's notification registry (`packages/keel/src/core/notifications.ts`) ships three channels:
`in_app`, `email`, `sms` (fake only). This is the written-down plan for adding a fourth — VAPID web-push to
the browser — for an instance that needs it. Nothing here is built; per `docs/development-approach.md`'s
recipe doctrine, the plan is the deliverable until a real app forces it.

## 1. A new `NotificationChannel`, and a new channel seam

Add `'web_push'` to the registry:

```ts
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'web_push'] as const
```

Nothing downstream in `packages/keel/src/core/notifications.ts` needs touching: `resolveEnabledChannels`
and `isChannelEnabled` iterate this array generically, so the opt-out resolver and the profile prefs grid both
pick up the new channel automatically. `notificationCopy` does need a case added if the copy differs per
channel (today it already splits `smsKey` from `bodyKey`/`titleKey`; a `pushKey` would follow the same
pattern) — a small, mechanical addition, not a new mechanism.

The channel seam itself mirrors `packages/keel/src/server-lib/sms.ts` exactly — a new
`packages/keel/src/server-lib/web-push.ts`:

```ts
export interface WebPushMessage {
    recipientUserId: string
    kind: string
    title: string
    body: string
    url?: string // deep-link the notification opens on click, if any
}
export type WebPushChannel = (message: WebPushMessage) => Promise<void>
```

`sendWebPush` selects fake vs. real behind `isSimulated`, same shape as `sendSms`: fake dynamically imports a
new `packages/keel/src/adapters/fake/web-push.ts` catch-store (`.data/web-push/`, same pattern as
`.data/sms/`, rendered as another Simulator Messages-tab row type); real mode is a no-op stub with a comment
pointing here until the adapter is wired. `packages/keel/src/server-lib/notify.ts`'s fan-out calls it
exactly like `sendSms`, keyed off `recipientUserId` rather than a single address — see §2, a recipient can
have more than one subscribed browser.

## 2. The subscription lifecycle

Unlike SMS (a phone number an instance already has), web-push needs the browser's cooperation first:

1. The client registers a Service Worker (a new `public/sw.js`, minimal: a `push` event listener that
   calls `showNotification`, and a `notificationclick` handler that opens `url`).
2. The client calls `pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })`, which returns a
   `PushSubscription` — an `endpoint` URL plus `p256dh`/`auth` keys (from `subscription.toJSON().keys`).
3. The client POSTs that subscription to a new app route, which persists it server-side. A user can have
   several live subscriptions (one per browser/device), so this is insert-only, not upsert-by-user.

The persisted table is a new tenant-scoped `push_subscriptions`, carrying the RLS pattern verbatim from
`apps/showcase/src/app-config/db/migrations/1001_tickets.ts` (and the org-scoped variant `0011_notifications.ts` already uses
for `notification_prefs` — same `tenant_id`/`org_id`/opaque-`user_id` shape):

```ts
.createTable('push_subscriptions')
.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
.addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
.addColumn('org_id', 'uuid', (col) => col.notNull().references('organizations.id'))
.addColumn('user_id', 'text', (col) => col.notNull())      // opaque actor id, same convention as notification_prefs
.addColumn('endpoint', 'text', (col) => col.notNull().unique())
.addColumn('p256dh', 'text', (col) => col.notNull())
.addColumn('auth', 'text', (col) => col.notNull())
.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
```

Real-mode `sendWebPush` reads every `push_subscriptions` row for `recipientUserId`, calls the vendor once
per row, and prunes rows the vendor reports as gone (410/404 — an expired or revoked subscription).
Plaintext `endpoint`/`p256dh`/`auth` at rest is a template-level simplicity, same posture as
`webhook_endpoints.secret` (0010_webhooks.ts) — a real instance may vault it.

VAPID is a keypair the instance generates once, not per-user — cutover rows, not code:

```ts
webPush: {
    // cutover: web-push-vapid
    publicKey: 'PLACEHOLDER_VAPID_PUBLIC_KEY',        // shipped to the browser, not secret
    privateKeyName: 'PLACEHOLDER_VAPID_PRIVATE_KEY_NAME',
    subject: 'PLACEHOLDER_VAPID_SUBJECT',              // a mailto: or site URL, required by the push protocol
},
```

| Status | Item             | What it is                                                                                            | What unlocks it                                             | Deferred verification                                                                                                                                              |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⬜     | `web-push-vapid` | VAPID keypair (public/private) + subject for browser push (names in `apps/showcase/config/params.ts`) | you generate a keypair (`npx web-push generate-vapid-keys`) | Real push through `packages/keel/src/adapters/real/web-push.ts`; a subscription registered by a real Service Worker; a push received and clicked in a real browser |

## 3. Where the vendor SDK goes

`packages/keel/src/adapters/real/web-push.ts` is the only file allowed to `import 'web-push'` (the npm
package) — the same ports-boundary rule as every other vendor SDK, lint-enforced. It wraps
`webpush.sendNotification` behind the `WebPushChannel` signature;
`packages/keel/src/server-lib/web-push.ts`'s real branch calls it. The fake in
`packages/keel/src/adapters/fake/web-push.ts` needs no vendor code at all — it just writes the
catch-store entry.

## 4. The static-demo caveat — a real physics degrade

`docs/development-approach.md` is explicit that the static demo degrades _only_ where physics forbid (no
server means no real HTTP or byte downloads, no filesystem means Snapshots can reset and replay presets but not save), and every such
degrade gets noted where it happens. Web-push is squarely in that category on `file://`:

- No server means no origin to register a Service Worker scope against in the way a deployed app has.
- No real push endpoint exists to subscribe to, and no server-side process could call it even if one did.
- Browsers also generally refuse Service Worker registration and Push API access outside a secure
  context/served origin, which `file://` is not.

So real browser push **cannot run** in the static twin — that is the degrade, and it is a hard one, not a
missing feature to backfill. What the twin still owes for world-surface parity (per the same doc's "an
empty tab would undermine the very proof it exists to make"): an in-memory "would-be push" entry, logged
into the same in-memory Messages surface the SMS twin uses, whenever a demo action would have pushed in a
real build. It proves the fan-out and prefs logic ran; it does not — cannot — prove a browser received
anything. Record this next to the channel, not just here, the same way `notify.ts`'s fan-out documents
every other channel's shape.

## 5. Why this is a recipe, not shipped code

Same two tests as every other candidate for template vendor code (`docs/app-coverage-gaps.md`):

- **Universality** — will every instance turn on browser push? No; it is even more opt-in than SMS
  (`SMS/push channels` sits at 4/19 in the capability × demand matrix).
- **New-class** — new mechanics beyond what the template already teaches? Push aside, no: it is the same
  "app-owned seam, fake selected behind `isSimulated`, vendor fenced into
  `packages/keel/src/adapters/`" shape the SMS
  fake and `webhook-dispatch.ts` already demonstrate end to end. The one genuinely new piece — the
  subscription lifecycle (Service Worker + `PushSubscription` + a stored table) — is real complexity, but
  it is complexity in service of a channel most instances won't ship, not a new integration class the
  template is missing.

Fails both → recipe. Building it into the template would mean maintaining a Service Worker, a subscription
table, and a static-demo physics-degrade note for a capability most instances will never turn on.
