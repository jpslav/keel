---
description: Add a background job kind + handler, registered through the app-config seam
---

Add a background job kind for: $ARGUMENTS

Jobs are the framework's async-execution seam (port `packages/keel/src/ports/jobs.ts`; state machine + statuses are
framework-owned). You register the app side — never edit a framework union:

1. **Handler** in `apps/showcase/src/jobs/<kind>.ts`: a `JobHandler` (`packages/keel/src/ports/jobs.ts`) — `(payload, ctx)` where
   ctx carries `db`/`storage`/`email` ports + tenant/org/job ids. Follow `apps/showcase/src/jobs/export-tickets.ts`.
   Result keys must live under `exportKeyPrefix(...)` (`packages/keel/src/core/jobs.ts`) — the storage-isolation
   contract; validate payloads defensively (they arrive as `unknown`).
2. **Register** in `apps/showcase/src/app-config/jobs.ts`: add the kind to `appJobKinds` and the handler to
   `appJobHandlers`. The framework composes `framework ∪ app` for `isJobKind` and the handler map.
3. **Submit path**: routes create jobs via the jobs port (see `apps/showcase/src/app/api/jobs/route.ts` and
   `dashboard-glue.tsx` for the submit + timeline pattern). Job authorization rides the framework
   `Job` subject — no new ability rules needed unless your kind implies a new entity.
4. **Recurring?** Seed a `job_schedules` row via `packages/seed` `jobSchedules` (the weekly digest is
   the worked example) — the schedules machinery is framework and needs no registration.
5. **Colocated test** beside the handler (fake ports; see `apps/showcase/src/app-config/jobs.test.ts`), then exercise
   the flow in Simulator's Jobs tab (hold/release via the `jobs-held` flag) and mirror any new demo
   surface in `apps/showcase/src/demo-static/app.tsx`.
6. Finish with `pnpm verify`.
