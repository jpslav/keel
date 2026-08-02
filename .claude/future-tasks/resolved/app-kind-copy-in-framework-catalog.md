# App-registered notification kinds must put their copy in the FRAMEWORK catalog

**Priority:** P1 · **Status:** CLOSED 2026-07-31 (`feat/support-desk`) — see ADR-0012
**Found by:** `apps/starter` (consumer #2), 2026-07-31. Recorded in ADR-0012, "App copy lives in the
app's catalog".

## What it was

The `notifications` i18n namespace is framework-owned, but app-registered notification kinds resolved
their copy _inside_ it — so keel's catalog carried five showcase-specific keys, and an app that
registered a notification kind had to edit the framework's catalog to give it copy. The
namespace-partition test permitted it; the framework/app line forbade it. It was the last place where
adding an app feature meant editing keel.

## How it was settled

**Option 2 of the three that were on the table**: the framework declares a copy CONTRACT and the app
satisfies it in its own catalog. `notificationCopy` (`keel/core/notifications.ts`) now stamps a
`namespace` onto the copy it returns — `notifications` for framework kinds,
`APP_NOTIFICATION_NAMESPACE` (`appNotifications`) for app-registered ones — and every surface that
renders a notification resolves `${namespace}.${key}` through a root translator: the header bell, the
notification email, the SMS channel, the prefs grid, and the static-demo twin.

The SEAM is unchanged: `appNotificationCopy` still returns bare keys, so an app that registers no kinds
(the starter) needed no edit at all. The partition test keeps `appNotifications` app-owned.

Two sibling leaks were closed in the same pass, since they were the same mistake on different surfaces:
a Simulator **actor** card is now handed finished strings by the host (`ActorSlot.title`/`.description`,
matching `SimulatorExtraTab.label`), and an app-registered Snapshots **flag** carries a fully-qualified
`namespace.key` path. Keel's catalog lost nine app-specific keys and gained none.
