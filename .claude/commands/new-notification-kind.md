---
description: Add a notification kind (producer + copy) registered through the app-config seam
---

Add a notification kind for: $ARGUMENTS

The notifications machinery (fan-out, prefs, bell) is framework; kinds are vocabulary you register:

1. **Register** in `apps/showcase/src/app-config/notifications.ts`: add the kind to `appNotificationKinds`
   (`<entity>.<event>` naming), its payload shape to `AppNotificationPayloadMap` (small + jsonb-
   serializable), and its copy to `appNotificationCopy` (compose from payload fields). The keys it
   returns resolve in the APP catalog's `appNotifications` namespace — `notificationCopy` stamps the
   namespace, so app copy never goes near keel's catalog. Add the keys to BOTH
   `apps/showcase/messages/en.json` and `es.json`.
2. **Produce** it at the mutation choke point that causes it — call the framework notify helper
   (`packages/keel/src/server-lib/notify.ts`) after your route's write commits. Pick the recipient
   shape deliberately: `escalation.received` uses `notifyAdmins` (a team's managers, produced in the
   escalations route); `ticket.assigned` uses `notifyMember` (one named person, produced in
   `apps/showcase/src/app/api/tickets/[id]/route.ts`, excluding the actor so self-assignment is
   silent).
3. **Prefs ride free**: every registered kind automatically appears in notification preferences
   (`NOTIFICATION_KINDS` composes framework ∪ app) — no extra wiring.
4. **Test**: assert produce → fan-out with the pattern in `apps/showcase/src/app-config/notifications.test.ts` /
   `packages/keel/src/server-lib/notify.test.ts`; check the bell + prefs UI shows it; mirror in the static twin if
   the demo world produces it. Finish with `pnpm verify`.
