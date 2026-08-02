---
description: Run the health scanners and triage findings into real issues vs baseline noise
---

1. Run `pnpm knip`, `pnpm jscpd`, `pnpm test:coverage`, and `pnpm outdated || true` (outdated is
   informational — never treat it as a failure).
2. Triage each knip finding: genuinely dead code → delete it. An intentionally-unused seam (port/adapter
   symmetry, `AUTHORED — CUTOVER` staged code) → add the narrowest possible `knip.json` entry and record
   the rationale in `docs/build-notes.md`.
3. Triage jscpd clones: real duplication → extract into `keel/core` or a shared component.
   Structurally-parallel-by-design code → add the narrowest `.jscpd.json` ignore, rationale in
   `docs/build-notes.md`.
4. Read the coverage summary and name the 3 worst-covered files under `keel/core` and
   `packages/keel/src/adapters/fake` (business logic first — page/glue files matter less). Add
   tests now, or list them for follow-up.
5. Done when `pnpm knip` and `pnpm jscpd` both exit 0 with every baseline entry justified, plus a
   report table: finding → real/noise → action taken.
