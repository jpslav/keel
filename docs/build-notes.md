# Build notes

Important things learned while building — the "wish someone had told me" file.

**Reading older entries.** These are dated and append-only: an entry was true when written and is
never edited to match today's tree, so a later entry supersedes an earlier one rather than replacing
it. Two vocabulary changes affect entries written before 2026-07-31 — the dev/demo panel was called
**Backstage** before it became the **Simulator**, and `isFakeMode` became `isSimulated`. Paths in old
entries may name files that have since moved; the doctrine docs under `docs/` are what the path gate
holds to today's tree.

- **pnpm ≥10 blocks dependency postinstall scripts by default.** The fix is an
  `allowBuilds` map in `pnpm-workspace.yaml` (not the older `onlyBuiltDependencies`). If an install "works"
  but a tool later misbehaves, check whether its build script was blocked.
- **`minimumReleaseAge: 2880`** (the supply-chain guard) means brand-new package releases (<2 days old) resolve
  to the previous version. Expected; don't fight it when pinning "latest".
- **House style source of truth:** `.editorconfig` (4-space, 120 cols, LF) + minimal `.prettierrc.json`
  (`semi: false, singleQuote: true`). Prettier 3 reads `.editorconfig` for indent — don't add `tabWidth` to
  the prettier config.
- **Do not make local development depend on docker.** Real-Postgres testing runs on `embedded-postgres`
  binaries, which need no daemon and no privileges; docker-based jobs belong in CI, where the runner
  already has it. A laptop that cannot run docker (or a VM without nested virtualization) is a normal
  environment, not an edge case, and the hermetic-dev invariant means it has to work there.
- **kysely 0.29 moved `Migrator` to the `kysely/migration` subpath export.** The community `kysely-pglite`
  dialect package (last published 2024) still imports it from the root and fails to load — we hand-roll a
  small dialect instead (`spikes/kysely-pglite/src/pglite-dialect.ts`).
- **Postgres GUC empty-string trap:** after any transaction has `SET LOCAL` a custom GUC,
  `current_setting(name, true)` returns `''` (not NULL) on that session, and `''::uuid` throws. RLS policies
  must wrap it in `NULLIF(..., '')` to stay fail-closed-by-empty instead of fail-closed-by-error.
- **A git token without the `workflow` OAuth scope cannot push ANY commit that touches
  `.github/workflows/`** — and the rejection is sticky: adding a later commit that removes the file does
  not help, because the offending commit is still in the range being pushed. The offending commit must
  not exist in the pushed history at all, so the fix is a rebase, not another commit.
- **eslint-plugin-react breaks under ESLint 10 when `settings.react.version` is `'detect'`** (the detection
  path calls the removed `context.getFilename`). Pin an explicit version (`'19.2'`) in eslint config.
- **Mantine's default `primaryShade` (6) fails WCAG AA for white-on-primary** (filled buttons). We set
  `primaryShade: 8` in `getTenantTheme`, and tenant hues must be chosen to pass at shade 8 (teal can't;
  demo-org uses grape). The axe e2e smoke is what catches regressions here.
- **ESLint flat config merges rule config by object key**: a later block declaring
  `no-restricted-imports` for a subset of files REPLACES the earlier vendor-SDK ban for those files —
  no error, no warning. Always re-include shared patterns (see `vendorSdkPattern` in eslint.config.mjs)
  and keep the planted-violation probe in the phase checklists.
- **Clerk v7 replaced the v6 `useSignIn` API** (`{ isLoaded, signIn, setActive }`) with a signals-based
  one (`{ signIn, errors, fetchStatus }` + `signIn.password()`/`finalize()`); the old API moved to a
  `legacy` export. Any pattern written against v6 needs translation when cribbing.
- **jsx-a11y/aria-role fires on ANY JSX attribute named `role`** — including your own props. Name such
  props `roleName`.
- **E2E against `next dev` needs generous expect timeouts** (we use 15s): first hits compile routes
  on-demand and parallel workers pile up compile latency.
- **Killing a `pnpm dev` wrapper PID orphans the real `next-server` child.** Orphans then compete for
  the single-connection pglite and poison later runs. Use `pkill -f next-server` when cleaning up.
- **Playwright flaking with `net::ERR_ABORTED; maybe frame was detached` and 30s timeouts, while the
  server logs show millisecond responses, is a PARALLELISM symptom** — the request was fine and the
  browser went away. Memory pressure on a small machine is one cause; a shared world between workers is
  another, and this repo turned out to have the second (see the 2026-07-31 entry that measures it, which
  supersedes the memory explanation this entry originally gave).
- **Never import `@sentry/nextjs` unconditionally** — even with `enabled: false` the import wires
  OpenTelemetry request hooks into every dev compile and measurably slows `next dev`. Both
  instrumentation files gate the dynamic import on `NEXT_PUBLIC_SENTRY_DSN`.
- **`scrubEvent` is pure and SDK-free, so the scrub proof runs anywhere** — `/dev/errors` imports it into
  a client component and the `file://` static shell to scrub a synthetic event entirely in the browser,
  no server or DSN. That's the whole point of keeping event scrubbing out of the Sentry adapter.
- **A Server Component can't pass a function prop to a Client screen** (only Server Actions cross that
  boundary). Since `src/components` screens are shared with the static shell (which has no server), the
  house answer is the "glue" pattern: the RSC page passes serializable data to a `'use client'` glue,
  and the glue supplies the callbacks (fetch → reload) — see `header-glue.tsx`, `analytics-dev-glue.tsx`.
- **The protected layout is an RSC that does NOT re-run on client-side navigation**, so server-side
  page-view capture there only sees full loads. Mount a `'use client'` `usePathname` beacon instead; give
  its `fetch` `keepalive: true` (a fast route change otherwise aborts the in-flight beacon → ECONNRESET)
  and make the receiving route parse the body fail-safe (`request.json().catch(() => ({}))`) so an
  analytics beacon can never 500.
- **Analytics events are an append-only JSONL log** (`.data/analytics/events.jsonl`), not one-file-per-item
  like the email catch store — events are high-volume and small. Reader splits lines, skips blanks,
  sorts newest-first, caps to the last 500.
- **Mantine `Switch` puts `data-testid` on the root label, not the `<input>`** — Playwright `.click()`
  toggles it fine, but `toBeChecked()` won't resolve; assert the resulting behavior (the flag-gated
  banner) instead. And a glue that `window.location.reload()`s after a toggle races a follow-up nav
  click — for a cross-page assertion use a full `page.goto()`, which can't be superseded by the stale reload.
- **knip dead-code gate baseline (`knip.json` has no comments, so the rationale lives here).** _Partly
  superseded — see the ADR-0012 PR-2 entry later in this file: once the framework moved into
  `packages/keel` with a wildcard `exports` map, the `migrate-handler` and migrations `entry`
  patterns below became redundant and were removed. The reasoning is kept because the same traps recur
  whenever a new non-statically-reachable entry point is added._
    - `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/proxy.ts` are NOT listed in
      `knip.json`'s `entry` — knip's Next.js plugin already detects them; adding them back trips its
      own "redundant entry pattern" config hint.
    - `src/adapters/real/migrate-handler.ts` IS a root-workspace `entry` — it's the migrator Lambda
      handler (ADR-0001, `AUTHORED — CUTOVER`), reached only via a `path.join(__dirname, …)` string in
      `infra/stack.ts`'s NodejsFunction bundling, which knip can't trace as a static import.
    - `src/db/migrations/*.ts` are a root-workspace `entry` — `src/db/migrations/index.ts` pulls each
      migration in with `import * as m0001 from './0001_tenants'` and assigns the whole namespace
      object into a `Record<string, Migration>` (structural typing, not per-export access), so knip
      can't see `up`/`down` as "used" by destructuring. Marking the files as entries (rather than the
      blanket `ignoreExportsUsedInFile`) relies on knip's default of not reporting unused exports on
      entry files themselves.
    - `src/styles/generated/**` is a root-workspace `ignore` — panda-codegen output, committed (so the
      static demo build doesn't need to run `panda codegen`), same directory eslint already excludes.
    - `infra`'s workspace gets an explicit `entry: ["app.ts"]` — `cdk.json`'s `"app"` field points at
      `app.ts` but knip has no CDK plugin, so without this the whole CDK stack (`app.ts`, `stack.ts`,
      `lib/tags.ts`, and the `aws-cdk-lib`/`constructs` deps they pull in) reads as unreachable.
    - Top-level `ignore: ["spikes/**"]` fully suppresses the `spikes/*` glob; `spikes/kysely-pglite` is
      a proof harness (not shipped code) whose Kysely migration file hits the same namespace-import
      false positive as `src/db/migrations` — not worth an `entry` carve-out for throwaway code.
    - Genuinely dead code deleted, not ignored: `src/i18n/navigation.ts` (a `next-intl` `createNavigation`
      wrapper from the initial scaffold — every actual redirect in `src/app` builds `` `/${locale}${path}` ``
      by hand instead of using it; zero imports anywhere), `getCaughtEmail` in
      `packages/keel/src/adapters/fake/email.ts` (no caller — `/dev/mailbox` only ever lists all
      caught emails, never fetches one by id), the `clsx` dependency (zero imports in `src/`), and the
      `@testing-library/react` devDependency (added at scaffold time, but there are no React component
      tests yet — Vitest units are core-logic-only and Playwright covers the DOM).
    - `export` dropped (symbol kept, only used within its own module) on `tenantsForPersona`
      (`packages/keel/src/adapters/fake/auth.ts`), `hashLlmRequest`/`fixturePath`/`LlmFixtureEntry`
      (`packages/keel/src/adapters/fake/llm.ts`), `TenantsTable`
      (`packages/keel/src/db/schema.ts`) and `NotesTable` (`src/app-config/db/schema.ts`) — for both,
      only `DB` is consumed outside the file — and `LlmMessage` (`packages/keel/src/ports/llm.ts` —
      callers only ever reach it through `LlmRequest['messages']`).
    - `postcss` moved from an implicit transitive dependency to an explicit devDependency —
      `postcss.config.cjs` (panda's PostCSS plugin) needs it resolvable and knip's config-file
      convention check flags that as an "unlisted dependency" the same way it would for `server-only`
      or `@pandacss/dev` if those went missing.
- **Coverage collection (`@vitest/coverage-v8`) is CI-only, report-only, for now.** `pnpm verify` and local
  `pnpm test:unit` stay uninstrumented (no v8 overhead in the inner loop); `pnpm test:coverage` runs in the
  `lint-typecheck-unit` CI job and appends a markdown table to the job summary from
  `coverage/coverage-summary.json`. No `thresholds` in `vitest.config.ts` yet — a self-tightening ratchet
  (`thresholds` + `autoUpdate: true`, set roughly 2% below the established CI baseline) lands in a later
  commit once a handful of CI runs establish that baseline; `autoUpdate: true` means vitest rewrites
  `vitest.config.ts` in place as coverage improves, so expect churn there — commit those threshold bumps
  rather than reverting them. knip did NOT flag
  `@vitest/coverage-v8` as unused (vitest's own dependency-checking already accounts for provider packages
  it loads by name), so no `ignoreDependencies` entry was needed — if a future knip upgrade starts flagging
  it, that's the false positive to add there.
- **jscpd (duplication) and gitleaks (secrets) are CI-only, never in local `pnpm verify`.** Duplication
  findings need human judgment (a mechanical threshold shouldn't block the inner loop) and gitleaks needs a
  binary download that would break hermetic local installs. `.jscpd.json`'s `pattern: "src/**/*.{ts,tsx}"`
  isn't anchored to the top-level `src/` — it also matched `spikes/kysely-pglite/src/**`, so `spikes/**` was
  added to its `ignore` list (same carve-out knip already makes for that proof harness) once the promoted
  originals (`packages/keel/src/db/with-tenant.ts`,
  `packages/keel/src/adapters/fake/pglite-dialect.ts`) showed up as clones of their
  spike sources. One real clone remains under the 2% threshold and is left for later judgment rather than
  refactored here: `requireUser`/`requireRole`/`signInPath` are byte-identical between
  `packages/keel/src/adapters/fake/auth.ts` and `packages/keel/src/adapters/real/auth.ts` —
  extracting them needs a shared default
  keyed off `getCurrentUser`, which is more than a trivial extraction. The gitleaks binary version is
  hand-pinned in `checks.yml` (currently v8.30.1) — dependabot's `github-actions` ecosystem only bumps
  action refs, not a version string inside a `run:` step, so nudge to bump it occasionally. Local gitleaks
  use is optional via `brew install gitleaks`.
- **`next/headers`' `cookies()` throws `` `cookies` was called outside a request scope `` when hit
  directly from a Vitest test** — confirmed by probing it directly against this Next version. Any
  fake-adapter code that reads/writes cookies (session, Backstage viewpoint) needs
  `vi.mock('next/headers', () => ({ cookies: async () => ({ get, set, delete } over an in-memory
Map) }))` to be unit-testable at all; see `packages/keel/src/adapters/fake/backstage.test.ts` and
  `packages/keel/src/adapters/fake/auth.test.ts` (the latter is the first unit test file fake auth
  has ever had).
- **Backstage continuity state (`.data/backstage/state.json`) is shared, persistent, and keyed by
  persona id** — exactly like `profile-overrides.json` and the analytics flags file, it survives
  across e2e spec files within one `pnpm test:e2e` run. A remembered active tenant or `lastPath`
  left behind by one spec (e.g. switching persona-admin to Demo Org) bleeds into any later spec
  that signs in as the same persona expecting a fresh state (`tenancy.spec.ts` assumed
  persona-admin always starts in Alpha). `tests/e2e/backstage-panel.spec.ts` clears the file in
  both `beforeAll` and `afterAll` — clearing only on one side isn't enough, since a prior spec's
  leftovers can corrupt this spec's own assertions and this spec's leftovers can corrupt the next.
- **A sandboxed reading-pane iframe (`sandbox=""`) kills anchor clicks by design** — that's the
  point (no script execution, no navigation from inside untrusted-ish email html), but it also
  means the Backstage Mail tab's "open the invite link" affordance can't just work inside the
  iframe. `mail-app.tsx` parses the message html with `DOMParser` (client-side only, guarded by
  `typeof DOMParser === 'undefined'` so this 'use client' component never trips over the browser
  API missing during SSR), extracts every `a[href]`, and renders each as a real button below the
  iframe; the CALLER decides what an extracted href is allowed to do (the real glue
  `window.location.assign`s same-origin targets — a path starting with `/`, or an absolute URL
  whose origin matches `window.location.origin` (needed once the invite email's accept link
  became a real fully-qualified URL in slice 3, not just slice 2's relative placeholder); the
  static-demo glue maps `#/...` hashes through its own `go()`) — the component stays agnostic to
  which routing scheme is in play.
- **`.data/auth/personas.json` (the dynamic-personas overlay, new in slice 3) joins the same
  shared-persistent-file club as `.data/backstage/state.json`** — `tests/e2e/accept-invite.spec.ts`
  clears both in `beforeAll`/`afterAll` for the same reason as the continuity state above.
  `.data/auth/invites.json` is deliberately NOT cleared: it's never purged by any spec (mirroring
  the fake email store), so specs use a unique invite email per run instead and a lingering
  invite from an earlier run is harmless clutter, not a correctness risk.
- **`PGliteDriver.destroy()` (`packages/keel/src/adapters/fake/pglite-dialect.ts`) was always a
  no-op, and the raw PGlite client wasn't even cached** — only `{ db, ready }` lived on
  the fake-db global (`globalThis.__appFakeDb`), so nothing in the codebase could actually close the
  pglite instance.
  That's a hard blocker for Scenes' world reset: `.data/pglite` can't be safely wiped out from
  under an open connection. `packages/keel/src/adapters/fake/db.ts` now also caches the raw
  `client` and exports
  `closeFakeDb()` — await `ready` first (swallowing its rejection; never close mid-migration), then
  `client.close()`, then delete the global cache. Because `instance()` is lazy, the very next
  request after `closeFakeDb()` transparently re-creates, re-migrates, and re-seeds a fresh pglite
  instance — no server restart needed. `resetWorld`/`saveScene`/`restoreScene`
  (`packages/keel/src/adapters/fake/backstage-admin.ts`) all call it before touching `.data/pglite`
  on disk.

- **Specs that wipe `.data` mid-suite need their own Playwright project, sequenced after the
  parallel one** — `fullyParallel: true` means any spec that deletes shared fake-adapter state
  (Scenes' world reset being the extreme case) can yank files out from under every other spec's
  assertions. The `destructive` project in `playwright.config.ts` (`dependencies: ['chromium']`,
  own `tests/e2e/destructive/` dir the main project ignores) makes Playwright run it strictly
  after the whole main suite. Related gotcha: after a same-URL `window.location.assign` reload,
  neither `waitForURL` (already matching) nor waiting for an element to detach (the new document
  mounts an identical one, so polls can miss the teardown window) is reliable — stamp a property
  on the old `window` and `waitForFunction` for it to vanish.
- **A fully sandboxed iframe (`sandbox=""`) swallows clicks with zero feedback** — users read a dead
  "Accept invitation" button as "the app is broken", not "the preview is inert". If you sandbox rendered
  HTML, either bridge the clicks out (`allow-scripts` + postMessage to the parent, which applies its own
  navigation policy — the frame stays an opaque origin and still can't navigate anything itself) or label
  the pane as a preview. We do the former in `packages/keel/src/components/backstage/mail-app.tsx`.
- **`localhost` and `127.0.0.1` are different origins AND different cookie hosts.** Switching between them
  looks like "signed out and my panel state is gone" (cookies + localStorage are per-host), and absolute
  URLs minted against one origin fail same-origin checks on the other. Backstage's link handler now says so
  out loud (notice strip) instead of silently dropping the click; the invite accept URL is still built from
  `request.url`, so demo on the host you invited from.
- **`react-hooks/set-state-in-effect` disables must sit immediately before the offending call.** Moving a
  guarded call from `if (x) void f()` into a block body (`if (x) { void f(); ... }`) detaches the
  `eslint-disable-next-line` from the call it was excusing; the comment moves inside the block with it.
- **next-intl's `getTranslations({ locale, namespace })` works in route handlers** — that's how the invite
  email is localized outside any page context (the email itself is rendered with plain string props).
- **Initials avatars are white-on-dark, not hash-colored — WCAG AA forced the choice.** Mantine's
  `color="initials"` (light variant) renders the hue as colored text on a light tint that lands
  ~3.7–4.4:1 for many hue+initials combinations (grape/violet/blue/indigo all fail axe for some
  hashes); `autoContrast` doesn't help (its luminance threshold isn't 4.5:1-aligned) and the plain
  gray placeholder is ~4.26:1 too. `packages/keel/src/components/auth/preview-row.tsx` pins the
  avatar placeholder to white on `dark-6` (~15:1) so any initials pass. Also: an open Mantine `Menu`
  trips axe `region`
  (it portals to `document.body`, outside landmarks) and `aria-required-children` (its autofocus
  `role="presentation"` helper sits inside `role="menu"`) — framework quirks, so the open-popover a11y
  test (`a11y.spec.ts`) is scoped to `color-contrast` and disables transitions (a mid-fade frame reads
  as a false contrast failure). `Menu.Label` defaults to dimmed gray-6 — override to `gray.7`+ for AA.
- **The org remodel changes on-disk `.data/` shapes — wipe or Scenes-reset after pulling it.** The fake
  session JWT claim moved `tenant`→`org`; `invites.json` uses `orgSlug` (was `tenantSlug`); dynamic
  `personas.json` entries now carry `memberships[]` (no flat `role`); `keel/state.json` remembers
  `activeOrgSlug` (was `activeTenantSlug`). Readers fall back gracefully (a stale/absent claim resolves to
  the persona's first membership), but a dev mid-upgrade can see a persona "stuck" in an odd org until the
  files refresh — `rm -rf .data` or run the Backstage Scenes reset. Old Scenes snapshots are invalidated.
- **A drag handle needs pointer capture, or the drag dies the instant the cursor crosses an iframe.** The
  Backstage resize seam sits right next to the Mail tab's sandboxed reading-pane iframe; without
  `setPointerCapture` on `pointerdown`, `pointermove` events landing inside the iframe never reach the seam
  (different browsing context) and the drag silently stops tracking. Capturing the pointer on the seam
  element fixes it; while dragging, the content pane also gets `pointerEvents: 'none'` so a fast drag can't
  refocus into the iframe at all.
- **ARIA prohibits naming a generic element** — `axe`'s `aria-prohibited-attr` fails on an `aria-label` (or
  `aria-labelledby`) placed on a plain `<div>`/`Box` with no ARIA role, because a nameless generic element
  isn't allowed a name. Give the element a role that accepts naming (`role="group"` for the Backstage persona
  chip) rather than dropping the label.
- **An iframe pointed at another route under the SAME `[locale]` layout re-mounts everything that layout
  mounts — including Backstage itself.** The actor host pages
  (`src/app/[locale]/backstage/actors/[actor]`) live inside the same layout that dynamic-imports
  `BackstageGlue`; without an explicit guard, each actor iframe would mount its own nested panel and
  polling loop. `BackstageGlue` now checks `usePathname()` first and renders bare `children` for any
  `/backstage/actors/` path, delegating the panel and all its hooks to an inner component so rules-of-hooks
  stays intact. Worth remembering for any future full-page route nested under a layout that mounts global
  chrome.
- **A same-origin iframe route cold-compiles on its first hit in dev mode — budget Playwright timeout for
  it.** Each Backstage actor frame is its own Next.js page; the first request against a freshly started dev
  server pays Next's on-demand compile for that route on top of the app shell's, easily blowing the default
  30s Playwright timeout. `tests/e2e/destructive/actors.spec.ts` sets `test.setTimeout(120_000)` on every
  test in the file for this reason — do the same for any spec that's first to touch a route nobody's hit
  yet in that dev-server process.
- **`display: none` on a custom-styled native input hides it from BOTH gates that would normally catch
  an a11y regression.** The artifacts dropzone's hidden `<input type="file">` first shipped with
  `display: none`; `axe` only audits the accessibility tree, so an element that isn't in it (because
  it's `display: none`) simply has nothing to flag, and e2e's `setInputFiles` targets the input handle
  directly, bypassing focus and the keyboard path entirely — both gates stayed green while keyboard/AT
  users had no way to open the file picker. Caught by manual review, not either automated gate. Fix:
  the standard visually-hidden-but-focusable technique (absolute position, a 1px box, clipped overflow
  — never `display: none` or `visibility: hidden`) on any custom-styled native control. Worth a
  deliberate keyboard walkthrough for any future hand-rolled input, since neither axe nor
  `setInputFiles`-based e2e will notice this class of bug.

## Playwright reuseExistingServer trusts whatever owns :3000

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. If another project's dev server
happens to be squatting the port (a stale `next dev` from a sibling repo, say), local e2e will silently
run against the wrong app — symptoms are uniform 500s or assertions about pages that don't exist. Check
`lsof -nP -iTCP:<port> -sTCP:LISTEN` before debugging "impossible" e2e failures.

**Largely solved as of 2026-07-31** — this note nominated "parameterizing the port via `PORT` env" as
the durable fix, and that is now what happens: `scripts/ports.mjs` derives every port from the checkout
path, so a linked worktree under `.claude/worktrees/` gets its own and cannot collide with the main
checkout or another session. The main checkout keeps :3000/:3100 so the runbooks stay true, which means
this failure is still reachable between the main checkout and a foreign repo — the `lsof` check above
is still the first thing to run.

## CI-only checks aren't in `pnpm verify` — gitleaks bit us

`pnpm verify` runs typecheck/lint/unit/e2e/demo, but CI (`.github/workflows/checks.yml`) _additionally_ runs
coverage, jscpd, and **gitleaks**. The service-auth slice added a literal `WEBHOOK_SECRET` fixture in
`packages/keel/src/service-auth/webhook.test.ts` to exercise the real-mode branch; gitleaks'
generic-api-key rule flagged it (2 findings) and turned `main` red _after_ merge, since the local gate never
runs gitleaks. Fix: a narrow, justified `.gitleaks.toml` allowlist scoped to that one file

- that exact placeholder string. Note gitleaks scans full history, so an allowlist (applied to every
  commit at scan time) is the only fix for an already-committed fixture — renaming the current line
  leaves the historical commit flagged. To reproduce locally: download the pinned gitleaks binary and
  run `gitleaks git --redact --config .gitleaks.toml`. Consider adding gitleaks to a pre-PR step.

## tenancy.spec.ts:73 flakes on CI first-attempt (retry-green) since the dashboard grew a jobs poll

`notes are scoped to the active org` intermittently fails its first CI attempt and passes on retry
(the `e2e` job stays green). It began with the jobs slice, which added an ExportCard to the dashboard
that fetches `/api/jobs` on mount and polls every 3s while a job is non-terminal — the extra async
work most plausibly delays the org-switch reload enough that Playwright occasionally samples a stale
frame before asserting `not.toContainText(researchNote)`. Not a notes-scoping regression (no slice
touched notes/org logic; it's caught by the assertion's own retry). Not locally reproducible (local
e2e runs single-worker).

It worsened: after the llm-tools merge the suite got heavy enough that `switchOrg`-based tests
(`tenancy.spec.ts:73`, `org-requests.spec.ts:92`) started exhausting Playwright's retries and turned
the main `e2e` job red twice in a row. The traces showed the real mechanism: the timeout was on the
MENU ITEM click, meaning the trigger click landed before React hydrated (each of these tests clicks
the switcher immediately after a cast/reload) and was silently swallowed — the menu never opened, so
the item click stalled for the whole test timeout. Fixed by extracting a hydration-safe
`pickOrg(page, slug)` helper (`tests/e2e/support/org-switcher.ts`) that retries the open until the
item is actually visible — the same `expect(async … ).toPass()` idiom the note/request helpers
already used — and using it at every `org-switcher-item` click site. If a switcher test flakes
again, the failure will now point at a real post-switch assertion, not the menu.

## Editing the assistant's system prompt or tool description silently falls back to the wrong fixture answer

`lookupToolLoop` (the fake llm adapter's tool-loop path) hashes `{model, system, messages, tools}`
to match a fixture entry, same as the single-turn path — but unlike the single-turn path, a
tool-loop purpose with a `response`-only default entry (`assistant-demo.json` has one) degrades a
hash-miss to a SILENT one-turn text answer instead of a loud "no matching fixture" error. So
editing `ASSISTANT_SYSTEM` or `LIST_MY_NOTES_TOOL.description` (`src/app/api/assistant/tool.ts`)
without also updating the fixture doesn't crash anything — the assistant just quietly stops using
the tool and answers with the generic default. Only `tool.test.ts`'s fixture-contract test (which
asserts the recorded conversation, not just "some" response, comes back) catches the drift. If you
touch either string, run that test before trusting the change.

## Unit job has no CI retry — pglite's cold-init cost turned into an occasional timeout flake

The first test in a worker to touch the fake DB pays pglite's cold migrate-and-seed cost in-process
(see the `PGliteDriver.destroy()` note above — `instance()` is lazy, so this can happen on any
DB-touching test, not just the first file). Under full-suite parallel load that occasionally
exceeded Vitest's 5s default `testTimeout` and flaked the unit job. Unlike `e2e` (which retries on
CI), the unit job has zero retry budget, so one slow worker turned `main` red. Fix: `vitest.config.ts`
now sets `testTimeout: 20_000` globally — generous headroom without masking a genuinely hung test. If
a DB-touching test still times out at 20s, treat it as a real hang, not cold-init.

## Sharp edges from the jobs, schedules, webhooks and notification slices (2026-07)

_This section grew past its original heading. It started as notes on scheduled jobs and became
the general "wish someone had told me" list for that stretch of the build — RLS scans, jsonb on
two engines, timestamp columns, isomorphic signing, fake-adapter fan-out, inbound webhook
signatures, render purity. Skim the bold lead-ins; they are the index._

- **`react-hooks/purity` forbids `Date.now()` during render.** The static-demo world clock needs
  "real now + offset" both to display and to decide what's due. Calling `Date.now()` in the render
  path trips the purity lint. Fix: capture the anchor ONCE in a lazy `useState(() => Date.now())`
  initializer (the one place an impure read is allowed) and read `mountedAtMs + offset` everywhere —
  render-pure, and consistent with the seed schedule's `next_run_at` basis (also computed at mount).
- **An iframe in server-rendered HTML holds up the host page's `load` event.** Making the Simulator's
  actor frames mount from page load put two same-origin iframes into every page's SSR output. A
  document's `load` waits for its subframes, so every page — and every Playwright
  `waitForURL(..., 'load')` — also waited on two dev-server builds of the actor page. The e2e suite went
  from 1.7m to 3.1m with two minute-long timeouts. Mounting background iframes just after the host's own
  `load` (`tab-mount.ts`'s `pageLoaded`) brought it back to 1.8m with none (2026-10-03).
- **`react-hooks/purity` can blame a `Date.now()` you didn't touch.** In
  `packages/keel/src/demo-static/world.ts`, adding any CALL on a seed person's `memberships` inside
  `useDemoWorld` (an inline `.map`, or a module-level helper taking the array) made the rule flag the
  `Date.now()` in `startJob`, ~400 lines away, inside an event handler. Passing the array through
  untouched (`orgs: p.memberships`) and shaping it in the consumer clears it. If purity fires on a line
  you didn't change, look for a new call on a captured value in the same hook (2026-10-03).
- **A raw cross-tenant scan of a FORCE-RLS table only _appears_ to work on pglite.** The due-scan's
  first draft read `job_schedules` via `db.getDb()` with no tenant set — green everywhere locally
  because pglite's default role is a superuser that bypasses RLS. On a real Postgres role (Aurora's
  master user included) FORCE RLS defeats even the table owner's bypass, so that scan returns zero
  rows and schedules silently never fire; the contract suite can't catch it either (it connects as a
  superuser too). Pre-merge review caught it; `runDueSchedules` now enumerates `tenants` raw (no RLS
  on that table — the `tenant-lookup` precedent) and reads each tenant's due schedules INSIDE
  `withTenant`, which needs no privileged role in any mode. The lesson generalizes: any system-wide
  scan of a FORCE-RLS table must be shaped as tenants × withTenant, never a raw read that "works on
  my machine". (`listWorldJobs`/`listSchedulesForWorld` stay raw deliberately — they are
  fake-mode-only god-views that 404 in real builds.)
- **`next_run_at` is the first required (no-default) timestamptz column**, typed `Date | string` in
  the Kysely schema: you INSERT a `Date` (from `computeNextRunAt`) or an ISO string, and it reads back
  as a `Date` on both engines (normalise with `toIso` / `new Date()`). Don't mark it `Generated<>` —
  that would make it optional on insert, but nothing defaults it.
- **Seed idempotency without a natural unique key.** `job_schedules` has no column tuple worth a
  UNIQUE constraint (an org can have many schedules of a kind), so `seedDb` uses check-then-insert for
  the demo digest rather than `onConflict`. `next_run_at` must be set once at creation and thereafter
  owned by the scheduler — re-running the seed must NOT reset it, which check-then-insert guarantees.
- **The e2e resets the world first, on purpose.** A destructive spec that advances the clock leaves
  `next_run_at` advanced in pglite; to stay deterministic across local re-runs, the spec POSTs
  `/api/backstage/reset` at the start so the seed recomputes a next_run_at within a week, making the
  `+1w` advance cross it every time. It runs in `tests/e2e/destructive/` (it mutates the shared world
  clock, spawns cross-tenant jobs, and writes mail).
- **A JS array into a `jsonb` column breaks on real Postgres but "works" on pglite.** Same
  family as the FORCE-RLS trap above. `node-postgres` serializes a JS ARRAY as a Postgres ARRAY literal
  (`{a,b}`), NOT JSON — so inserting `event_kinds: ['job.status_changed']` straight into a jsonb column
  throws `invalid input syntax for type json` on real Postgres, while pglite accepts it, so the unit
  test passes and the contract test would break. Plain OBJECTS are fine (node-postgres JSON.stringifies
  them — `jobs.payload`/`schedules.spec` rely on that); only ARRAYS bite. Fix:
  `packages/keel/src/db/jsonb.ts`'s `jsonb(value)` helper wraps the value as a JSON string with an
  explicit `::jsonb` cast, unambiguous on both engines. Use it for any array-valued jsonb column; the
  RLS proof suite exercises it so the contract job catches a regression.
- **`packages/keel/src/db` must not import `@/adapters` — it drags `server-only` into happy-dom
  unit tests.** The webhook drain needs a dispatcher that selects fake-vs-real by
  `isFakeMode` (from `@/adapters`, whose barrel starts with `import 'server-only'`). Importing that
  anywhere in `packages/keel/src/db`'s graph made EVERY `packages/keel/src/db` unit test
  throw "This module cannot be imported from a Client Component" — vitest runs in happy-dom, where
  `server-only` resolves to its throwing client build. Fix: the drain takes the dispatcher as a
  PARAMETER (the `runDueSchedules`-injects-`JobsPort` shape), importing only its TYPE from
  `packages/keel/src/server-lib` (erased at runtime). Routes — which already use `@/adapters` —
  pass the real `dispatchWebhook`; the drain's unit test passes the fake directly. Keep
  `packages/keel/src/db` adapter-free.
- **A pure isomorphic HMAC beats Web Crypto for the `file://` twin.** Signing must run in the
  server AND the static demo (the twin "really signs"). `node:crypto` can't bundle into the vite
  `file://` page; `crypto.subtle` is async and its secure-context guarantee on `file://` is
  browser-dependent. A plain-TS SHA-256/HMAC over bytes (`TextEncoder` is a global everywhere) is
  synchronous, isomorphic, and dependency-free. Hand-rolling a crypto primitive is normally a smell, but
  a colocated test cross-checks every output against `node:crypto` (block-boundary, long-key, unicode
  cases) — the primitive is pinned, so this is safe. Tests may import node builtins even under the
  core-is-pure lint (it bans vendor/framework imports, not `node:*`).
- **A fake adapter that fans out notifications must import the fan-out DYNAMICALLY.** The
  notification fan-out (`packages/keel/src/server-lib/notify.ts`) transitively imports
  `@/adapters` (through `deferAfterResponse` and the sms seam), and `@/adapters` imports `fakeJobs`. So
  a STATIC `import { notifyJobTerminal } from '@/server-lib/notify'` inside
  `packages/keel/src/adapters/fake/jobs.ts` would close the loop
  `@/adapters → fake/jobs → notify → @/adapters` and leave `isFakeMode`/port bindings in
  the TDZ at module-eval. The fake executor uses `await import('@/server-lib/notify')` at call time —
  the exact `dispatchWebhook`-imports-`fakeDispatchWebhook` trick from the webhook drain — and builds the fan-out
  deps from the fake adapters it already imports (`fakeDb`/`fakeEmail`/`fakeSendSms`/`personaLocale`).
  Routes, which already live on `@/adapters`, import `notify` statically and pass `makeNotifyDeps()`.
- **`Generated<string>` timestamp columns reject a `Date` in `.doUpdateSet` / `.set`.** The
  `notification_prefs.updated_at` upsert typed as `Generated<string>` won't take `updated_at: now`
  (a `Date`) — Kysely's insert/update value type for a defaulted `string` column is `string | undefined`.
  Pass `now.toISOString()`. (Contrast `notifications.read_at`, typed `Date | string | null` in the
  schema on purpose, which DOES accept a `Date` in `.set`.) Match the column's schema type to what you
  write, or convert at the call site.
- **Firing job-completion notifications from the always-on fake executor is a blast-radius risk.**
  `executeJob` runs inline for EVERY fake job in EVERY test, so notifying on completion adds
  admin emails/SMS/in-app rows to unrelated suites. Two guards keep it safe: it fires ONLY for the
  user-facing `export-notes` kind (the internal `digest-email` never notifies), and the whole call is
  best-effort in a `try/catch` (`notifyTerminal`) so a notification failure never fails the job. Mail
  assertions elsewhere key off specific subjects/recipients (never a global count), so admin
  notification mail doesn't perturb them — but a new test that counts a mailbox must scope to a subject.
- **Mailgun's inbound HMAC concatenates `timestamp + token` (no separator)** — different from the
  outbound webhook's Stripe-style `{t}.{body}`. Don't reuse `signWebhookBody` blindly; inbound email added `hmacSha256Hex` +
  `mailgunSignature` + `verifyMailgunSignature` to `packages/keel/src/core/webhook-signing.ts`, all
  cross-checked against `node:crypto` in the colocated test. The pure recompute + freshness live in
  core; the signing-key lookup and the token replay guard (stateful) live in
  `packages/keel/src/service-auth/mailgun.ts`.
- **`audit_events.org_id` is NOT NULL, so unresolved inbound can't be audited.** Intake records
  `inbound-email.received` (and the note handler `note.created`) ONLY for STORED rows, which always have a
  resolved org. An unparseable/unresolved recipient is dropped with a 200 and no row/audit at all — there
  is no tenant/org to file it under in the single-domain template. Don't try to audit a null-org intake.
- **The `webhooks/` authorize-exemption `mustMatch` is a per-file gate, so a new webhook route with a
  DIFFERENT verifier fails the scan until the regex is widened.** The inbound-email route uses
  `withMailgunSignature`, not `withWebhookSecret`; `authorized-mutations.test.ts` required generalizing
  the prefix `mustMatch` to `/with(?:WebhookSecret|MailgunSignature)\s*\(/`. If you add a third webhook
  auth mechanism, widen it again (the exemption is enforced, not prose).
- **World-list `created_at` is typed `string` (schema `Generated<string>`) but reads back a `Date` on
  real pg** (the webhooks.ts precedent). `r.created_at instanceof Date` is a TS error because
  the static type is `string`; use a local `iso(value: unknown)` helper so the runtime `Date` from real
  Postgres normalizes without a type error.
- **A note created by inbound email must audit for the RESOLVED org, not the signed-in viewpoint**
  (static twin). The twin's `logAudit` hardcodes the active tenant/org + signed-in persona;
  `composeInbound` can't reuse it because an inbound note lands in whatever org the address names (often
  not the one you're viewing) and is attributed to the SENDER. It writes the audit row with explicit
  `seedOrg.tenantSlug`/`seedOrg.slug` + the matched persona id instead — matching the server intake.
- **`next-intl` dynamic message keys need a cast.** ``t(`inboundStatus_${status}`)`` where
  `status` is a runtime string won't typecheck against next-intl's literal key union; cast to one known
  key (`as 'inboundStatus_handled'`). All four `inboundStatus_*` keys exist in both locales (the
  messages-parity test enforces identity), so the runtime lookup is always present.
- **A fake-world display constant that looks like a deployment param isn't one.**
  `DEMO_INBOUND_DOMAIN` (`packages/keel/src/core/inbound-email.ts`) is the address domain
  Backstage's "compose inbound" and the static twin build under — it stays in
  `packages/keel/src/core`, not `config/params.ts`, because
  it's simulated-world display data, not a deployment parameter (the real inbound domain is
  `config/params.ts`'s `mailgun.domain`, and the real webhook only ever parses the domain a message
  arrives on). Don't move it to `config/params.ts` if you go looking for it there.
- **knip flags unused exported TYPES, not just values.** `GateScope`/`GateBehavior` in
  `packages/keel/src/core/gates.ts` were referenced only internally (by the `Gate`/`PendingGate`
  interfaces), which compiles fine under `tsc --noEmit` but trips knip's "Unused exported types". They're
  the gate seam's
  public vocabulary, so the fix was to genuinely CONSUME them rather than drop the export or add a knip
  ignore: `gatesForAgreements` annotates `const scope: GateScope` and `const behavior: GateBehavior`.
  `PendingGate` was NOT flagged — knip counts a type used as a function return type as consumed.
- **Mantine `Alert` needs `closeButtonLabel` to stay axe-clean.** The advisory-agreement
  banner uses `withCloseButton`; without a label the close button has no accessible name, which the
  a11y sweep (demo-org personas see this banner) would flag as `button-name`. `closeButtonLabel={t(...)}`
  (a real Mantine `Alert` prop) fixes it — the demo-banner has no close button so this was new here.
- **A gate must not create a redirect loop; render the interstitial IN the layout, don't redirect.**
  Early temptation is to `redirect('/agreements')` from the protected layout for a pending
  gate — but the resolution route would itself be under `(protected)`, re-trigger the gate, and loop.
  The layout instead renders the interstitial IN PLACE (children ↔ interstitial swap), and the accept
  POST lives under `/api` (outside the layout) + reloads. signin/accept-invite are outside `(protected)`
  already. Net: no route needs allowlisting in v1 and no loop can form. If a future rider DOES resolve
  on its own route (e-sign), that route must live outside `(protected)` or be explicitly allowlisted.
- **A brand-new invited persona would hit a block-all gate — clickwrap-on-join is the fix.**
  Pre-accepting SEED personas keeps their sign-ins green, but a dynamically-created invited persona
  (accept-invite specs, real AND static) has no seeded acceptance and lands in tenant alpha, so the
  block-all ToS would replace the dashboard the specs assert on. Recording acceptance of current
  agreements at invite-accept time (both hosts) keeps those specs green without editing them and is
  product-honest. Watch for this whenever a new persona can be born into a gated tenant.
- **Inexplicable mass e2e failures? Check who owns port 3000 before debugging anything.** Playwright's
  webServer reuses an existing server on :3000 in dev, so a FOREIGN dev server squatting the port (e.g.
  another repo's `next dev` left behind by a different session) makes the whole suite run against the
  wrong app: `toBeVisible` failures on pages that "obviously" render, partial passes, and
  `ERR_CONNECTION_REFUSED` phases while the foreign server recompiles — none of it reproducible once
  the port is free. Diagnostic: `lsof -nP -iTCP:3000 -sTCP:LISTEN` (a `next-server` version that isn't
  this repo's is the tell); kill it and rerun. Observed 2026-07-23 during the round-2 completion pass —
  two full verify runs burned on it.
- **A framework migration that ALTERs an app table breaks when the app table is renumbered later.**
  Moving `notes` to app migration `1001` (from `0002`) surfaced that `0003_organizations` did
  `ALTER TABLE notes ADD org_id` — a framework migration reaching into what is now an app table that
  runs LATER (1001 > 3), so migrate-to-latest failed with `relation "notes" does not exist` and cascaded
  into "relation tenants does not exist" across every DB test. Fix: the `org_id` column moved into
  `1001_notes`'s own `createTable` (notes now runs after `organizations`). Lesson: after renumbering a
  migration, grep the OTHER migrations for `ALTER TABLE <that table>` — the numbering convention (framework
  0001–0999, app ≥1001) only holds if app tables reference framework tables and never vice versa.
- **Wipe `.data` after any migration rename/renumber.** The persisted local pglite dev DB records applied
  migration NAMES; renaming `0002_notes`→`1001_notes` makes Kysely see a previously-applied migration that
  no longer exists (corrupt-history error). `rm -rf .data` before re-running `pnpm verify`/`test:contract`.
  Safe only pre-cutover (no real data yet).
- **The eslint merge trap struck again for the framework/app fence (PR 1a).** `no-restricted-imports` and
  `no-restricted-syntax` REPLACE (not merge) per file-match, so the fence had to re-list `vendorSdkPattern`
  in every framework block that adds `appCodePattern`, adapters needed their OWN block (appCode only, since
  they legitimately import vendor SDKs), and the app/component `no-restricted-syntax` blocks had to re-list
  `getDbSelector`/`processEnvSelector` when layering on the new `a11yLiteralSelector` (with a stories/tests
  carve-out expressed as `ignores`). Shared const selectors keep the duplication honest.
- **knip entry added: `src/app-config/db/migrations/*.ts`** (`knip.json`, PR 1a). Mirrors the existing
  `src/db/migrations/*.ts` entry — migration files export `up`/`down` consumed only via `import * as m`
  namespace through the registry index, which knip can't trace to individual members, so each migrations
  dir is declared an entry point. Narrowest justified addition; no broad ignores.
- **`vi.mock()` paths are module specifiers too (PR 2).** The package move's import rewrite covered
  `import`/`export … from`/`import()`/`require()` and left `vi.mock('@/adapters')` alone — 31 test files
  went green on typecheck and then failed at runtime with `server-only`'s "cannot be imported from a
  Client Component" (the un-rewritten path resolved to a DIFFERENT module id than the one under test, so
  the mock silently didn't apply and the real adapter barrel loaded). Any future path surgery must sweep
  `vi.mock`/`vi.doMock`/`vi.importActual` as well as import statements.
- **The framework package reaches out of its own tree in exactly two places (PR 2).**
  `packages/keel/src/{core/webhook-signing,service-auth/verify,adapters/fake/{auth,backstage}}.ts`
  import the repo-root `config/app.ts` (host identity, ADR: repo scaffold stays top-level), and
  `db/rls-pglite.test.ts` imports `tests/rls/proofs.ts` (the engine-agnostic proof suite the contract test
  also runs). Both are relative escapes (`../../../../…`) — deliberate and documented rather than
  papered over with an alias: at publish time they become a config injection point and a package-internal
  test helper respectively.
- **Panda's `include` must list the package (PR 2).** `panda.config.ts` globs source files to extract
  styles; a tree it doesn't list is invisible. Nothing broke this time (the components use Mantine, not
  Panda's `css()`), which is exactly why it would have been a silent trap later.
- **next-intl's plugin only auto-discovers `./src/i18n/request.ts` (PR 2).** With the request config
  inside the package, `createNextIntlPlugin()` must be given the path explicitly
  (`createNextIntlPlugin('./packages/keel/src/i18n/request.ts')`) or the app boots with no messages.
- **A split message catalog needs merging at EVERY load site (PR 2)** — the next-intl request config, the
  static demo shell (`src/demo-static/main.tsx`), and Ladle's global provider (`.ladle/components.tsx`).
  Miss one and that surface renders raw keys for half the app; the parity/partition tests only cover the
  catalogs themselves, not the wiring, so the e2e + static-demo runs are what catch it.
- **knip config for the package: `{ "project": ["src/**"] }` and nothing else (PR 2).** Entries for
  `src/db/migrations/*.ts`, `src/adapters/real/migrate-handler.ts` and `src/i18n/request.ts` were all
  reported as redundant — the package's wildcard `exports` map already makes every module an entry. That
  same wildcard is why knip cannot see dead code inside the package; see the ADR-0012 addendum.
- **Actor copy is app content living in a framework namespace (PR 2, known wrinkle).** Actors register
  through the seam (`src/app-config/actors.ts`) but their `titleKey`/`descriptionKey` resolve inside the
  framework's `backstage` namespace, so adding an actor means editing the FRAMEWORK catalog
  (`packages/keel/src/i18n/messages/*.json`) — the one place the catalog split didn't cleanly
  separate ownership. Left alone deliberately in the mechanical move; fixing it means either an
  app-owned actor namespace resolved by full key path, or seam-supplied label lookups.
- **A `dependencies` link between Playwright projects orders them; it does not serialize either one**
  (2026-07-30, `refactor/rename-framework-to-keel`). The `destructive` e2e project exists because its
  specs mutate the shared world under `.data`, and `dependencies: ['chromium']` correctly stops them
  racing the main suite. What it does not do is stop the eight destructive specs racing EACH OTHER —
  `fullyParallel` still applies within the project, and `test.describe.configure({ mode: 'serial' })`
  only orders the file it appears in. Every one of those specs resets scenes, clears mail, toggles
  webhook failures or jumps the world clock, so one spec's "reset world" can pull the floor out from
  under another spec's signed-in page — which surfaces as a bare navigation timeout with nothing in the
  logs to connect it to its cause. **This was invisible locally for the life of the repo** because
  `workers: process.env.CI ? undefined : 1` serializes everything on a laptop; it only appears on CI
  runners, intermittently, so it reads as flake. Playwright has no per-project worker count, so the fix
  is two passes in `test:e2e` with the destructive one pinned to `--workers=1 --no-deps`. The general
  lesson: **a config knob that makes a suite reliable locally can also make a real concurrency bug
  unreachable locally** — when local and CI differ on parallelism, the difference is a place bugs live.
- **A package that reaches out of its own tree only works while it has one consumer** (2026-07-30,
  `refactor/apps-restructure`). ADR-0012 knowingly shipped two relative escapes from
  `packages/keel/src` to the repo root and called them accepted warts. They were accepted for a good
  reason — there was exactly one host, so the escape was invisible — but that is also what made them
  invisible: nothing in the build could distinguish "the framework legitimately needs this" from "the
  framework is coupled to this particular app". The lint fence bans the app's `@/*` alias inside the
  package, which is why the escapes were written as `../../../../config/app` in the first place; a path
  that climbs out of a package is the shape a fence expressed in aliases cannot see. If you add a fence,
  ban the relative escape too, or you have only moved the coupling somewhere quieter.
- **The shared RLS proof suite was coupled to the demo app, so deleting the demo broke the framework's
  own tenancy proof** (2026-07-30, same branch). `tests/rls/proofs.ts` asserted on `notes`,
  `org_requests` and `artifacts`. That is the exact operation an adopter performs on day one, and it
  would have taken out `pnpm test:contract` — the anti-drift suite — with no obvious connection between
  cause and symptom. Worth generalizing: **anything the template tells an adopter to delete must not be
  load-bearing for anything the template tells them to keep.** The negative controls are the subtle part
  — the proof that isolation assertions are not passing vacuously lived only on an app table, so a naive
  split would have left the framework half unable to prove its own assertions meant anything.
- **`includeEntryExports` is the knob when a package's `exports` map blinds knip** (2026-07-30, same
  branch). A wildcard `exports` map makes every module an entry point, and knip does not report unused
  exports on entry files — so the dead-code gate silently stopped covering the whole framework when it
  became a package. Narrowing `exports` is the intuitive fix and is useless here (136 of 141 modules are
  genuinely imported from outside). Pair `includeEntryExports: true` with
  `ignoreExportsUsedInFile: { interface: true, type: true }` so public vocabulary a module also uses
  internally stops being a false positive while functions stay fully checked. This supersedes the
  earlier note in this file claiming the framework reaches out of its own tree in exactly two places —
  it now reaches out in none.
- **A squash merge of a base branch breaks every PR stacked on it, and the symptom is NO CI rather than a
  red X** (2026-07-30, `refactor/rename-framework-to-keel`). Squash-merging a PR rewrites its commits into
  one new commit on `main`, so a branch stacked on the original commits now carries changes that also
  exist on main under a different SHA. GitHub marks the stacked PR `mergeStateStatus: DIRTY`, and — this
  is the part that wastes the time — **it then cannot compute a merge commit, so the `pull_request`
  workflow never runs at all.** `gh pr checks` says "no checks reported", the checks tab is empty, and it
  reads as a broken workflow or a GitHub outage. `gh pr view --json mergeStateStatus` is the one-command
  diagnosis; `git rebase --onto origin/main <old-base-tip> <branch>` is the fix, dropping the
  now-duplicated commits. If you stack PRs here, rebase each one immediately after its base merges rather
  than waiting for CI to tell you — it won't.
- **Backstage Cast restores where a person last was, so an e2e helper must not assume where it lands**
  (2026-07-31, `refactor/extract-demo-world`). `castTo` in the notifications destructive spec waited for
  `/en/(dashboard|org)`, but the same test navigates Ada to `/en/profile` before casting away — so
  casting back legitimately restores profile. Whether the assertion held depended on whether the
  continuity write had landed before the cast, which is exactly the kind of race that reads as flake:
  intermittent in CI, green on a laptop, and it survived several PRs before failing three retries in a
  row. The helper now accepts any protected route, because what it actually needs to know is that the
  switch completed on a signed-in page — the nav click immediately after is what reaches the dashboard.
  **Continuity restore is a feature; tests that switch persona must treat the landing route as
  unknown.**
- **Narrowing a duplication-gate glob can FAIL the gate without any new duplication** (2026-07-31,
  `refactor/apps-tree`). Moving the app to `apps/showcase` meant rewriting `.jscpd.json`'s pattern, and
  the obvious rewrite — `src/**` → `apps/*/src/**` — dropped `packages/keel/src` out of scope. No code
  changed, no clone was added, and jscpd went from passing to **2.38% against a 2% threshold**, because
  a ratio's denominator matters as much as its numerator: keel's ~17k clean lines had been diluting the
  app's duplication. The scope that means what the gate is supposed to mean is all first-party source,
  `{apps/*/src,packages/*/src}/**` — 1.21%, green. Generalizable: **when a percentage-based gate changes
  verdict during a pure move, check what left the denominator before believing the number.** The same
  trap applies to coverage thresholds.
- **A tool plugin can be inherited from the root workspace and silently deactivate when a dependency
  moves** (2026-07-31, same branch). Moving `@ladle/react` from the root `package.json` into
  `apps/showcase` deactivated knip's Ladle plugin for `packages/keel`, which had been inheriting it — so
  keel's 11 story exports became "unused" the moment the dependency moved, with nothing in the diff to
  suggest why. Fixed by declaring what the stories are on keel's workspace
  (`"ladle": { "entry": ["src/**/*.stories.tsx"] }`) rather than ignoring them. Related pre-existing
  defect found while chasing it: `pnpm ladle` has not shown keel's stories since the ADR-0012 extraction,
  because Ladle's default glob is cwd-relative — see `.claude/future-tasks/`.
- **Next's standalone output nests under the app path in a monorepo** (2026-07-31, same branch).
  `server.js` is no longer at `.next/standalone/server.js` but at
  `.next/standalone/apps/<app>/server.js`, so any script that hard-codes the flat path breaks the moment
  the app stops being at the repo root. `scripts/serve-standalone.mjs` now discovers it. The deploy zip
  has the same shape — `docs/runbooks/deploy.md` carries the caveat.
- **A gate that reads the filesystem must be independent of build state** (2026-07-31,
  `refactor/apps-tree`). The doc-path guard checked `apps/showcase/dist-demo/index.html` — a legitimate
  citation, since that single file IS the artifact you hand a stakeholder — and passed locally, where a
  build had produced it, then failed on CI's clean checkout. The gate's verdict depended on whether
  someone had recently run `pnpm build:demo-static`, which makes it worse than no gate: it fails for a
  reason unrelated to the change under review. It now skips any path with a build-output segment
  (`dist-demo`, `.next`, `coverage`, `playwright-report`, `test-results`, `node_modules`, `.data`).
  Verified all three ways — green with the output present, green with it absent, still red on a genuinely
  broken path.
- **A bare-specifier alias can only ever name ONE app, and every tool that resolves it inherits that
  choice** (2026-07-31, `feat/starter-app`). `@app-config/*` is the seam the framework resolves app
  vocabulary through, and it was defined once in the root `tsconfig.json`, once in `vitest.config.ts`
  and once in `vitest.contract.config.ts` — all three pointing at `apps/showcase`. Adding
  `apps/starter` did not break any of them; it made them silently wrong, because keel's tests kept
  resolving the showcase's registrations no matter which app was nominally under test. The fix is
  per-app scoping wherever the alias appears: `vitest.config.ts` became three projects (`showcase`,
  `starter`, `repo`) each with its own alias set, and the app tsconfigs already had their own. Two
  tools cannot be scoped this way and are worth knowing about: **knip** resolves the alias from the
  root tsconfig, so `apps/starter`'s seam modules read as unreferenced files and had to be declared
  `entry` (`src/app-config/**/*.ts`, `src/seed/*.ts`) — that is the narrowest accurate description,
  since those modules exist to be imported by the framework across an edge knip cannot see, but it does
  put the starter's seam outside the dead-code gate. And **the contract runner** cannot be split at
  all without a second database: two apps share framework migrations 0001–0999 but diverge from 1001,
  so running the second app's `migrateToLatest` over the first's database makes Kysely report corrupted
  migrations. `apps/starter` therefore proves its RLS on pglite only, through the same composed runner.
- **The framework's own scheduled-work example queried an app table** (2026-07-31, same branch).
  `keel/jobs/digest-email.ts` read `.selectFrom('notes')` — a showcase table — so the framework did not
  compile against a second app at all. The static twin had had the seam for this since the world moved
  into the package (`DemoWorldOptions.digestBodies`); only the server handler had been left reading the
  demo's schema directly. The lesson is narrower than "check for app names": the twin and the server
  path are two implementations of one behaviour, and when only ONE of them has a seam, the other is the
  one that is wrong. Same shape, second instance: `notification-prefs-section.tsx` held a
  `Record<NotificationKind, string>` label map, a type that by construction includes app-registered
  kinds, and it had grown a hard-coded `'org_request.received'`. A literal keyed by a composed union is
  always a leak waiting to be found; it is now derived by the convention it already followed.
- **A second app costs ~13 duplicated glue files and the DRY gate noticed** (2026-07-31, same branch).
  jscpd went from ~1.7% to **1.91% against a threshold of 2** when `apps/starter` landed. Every clone
  pair is framework glue that Next.js requires to live in the app's `src/app` tree — the locale and
  protected layouts, the sign-in picker glue, the header glue, `api/auth/{dev-signin,org,signout}`,
  `api/respond.ts` — plus the RLS boilerplate the docs tell you to copy from `1001_notes.ts`. Nothing
  was weakened to make it pass, but a third app breaks this gate. The fix when that happens is to
  promote the framework's route glue into keel as re-exportable handlers (`export { POST } from
'keel/routes/auth/dev-signin'`), not to raise the threshold.
- **A package `exports` map enforces nothing when the repo aliases the package to source** (2026-07-31,
  `refactor/keel-public-surface`). `keel` resolves through aliases in `tsconfig.json`, both app
  tsconfigs, `vitest.config.ts`, `vitest.contract.config.ts` and each `vite.demo.config.ts` — and an
  alias bypasses Node's `exports` resolution completely. So narrowing the map from its wildcard to 120
  explicit subpaths changed no resolution at all: `pnpm typecheck` and `pnpm build` cannot tell the
  difference, which is exactly why the wildcard survived four addenda claiming the map "makes the public
  surface real". The enforcement is a local ESLint rule (`keel/public-surface` in `eslint.config.mjs`)
  that READS the map, so the manifest stays the single source of truth and there is no second list to
  drift. Generalizable: **whenever a manifest and a resolver disagree about who is in charge, the
  manifest is documentation** — check which one your build actually consults before trusting a boundary.
- **Measure a public surface by following dynamic imports, or you will misclassify** (2026-07-31, same
  branch). A static `import … from` scan said no app touched `adapters/real/*`, which made the whole
  directory look registry-internal. Three of its modules are React client components that app routes
  reach by `await import('keel/adapters/real/sign-in-form')` — they CANNOT come through
  `adapters/index`, which is `server-only`. Making the directory internal on the static reading would
  have broken real-mode sign-in with a boundary violation nobody's typecheck would catch (the alias
  resolves it anyway). The same sweep has to cover `vi.mock()` specifiers, which resolve exactly like
  imports; the fence rule checks all four forms for the same reason.
- **Narrowing the entry points is what gives knip dead-CHAIN detection** (2026-07-31, same branch). With
  every module an entry, two orphan internals where A imports B report only A's unused export — B looks
  used (by A) and is itself an entry, so it is never named. With the 29 internals no longer entries,
  both are reported as unused files. Also worth knowing: knip honours a `@public` JSDoc tag, which
  replaced the file-level `ignore` for the CDK migrator's Lambda handler — a symbol-level annotation at
  the point of truth keeps the rest of that file inside the gate, which a file glob cannot do.
- **`infra/` is outside every gate, so its paths rot silently** (2026-07-31, same branch).
  `infra/stack.ts` had bundled the migrator Lambda from `../src/adapters/real/migrate-handler.ts` ever
  since the framework moved to `packages/keel` — a path that has not existed for a week. The root
  `tsconfig.json` excludes `infra`, `pnpm typecheck` never compiles it, and CDK synth is not in
  `pnpm verify`, so nothing looked. If you move framework files, grep `infra/` by hand.
- **A symlinked working directory gives Next two module instances, and the symptom names the wrong
  thing** (2026-07-31, `feat/init-app`). The adoption acceptance test copies the repo somewhere and runs
  `pnpm verify` in the copy. Put that copy under `/tmp` on macOS — which is a symlink to `/private/tmp` —
  and `pnpm test:e2e` fails deterministically with `` `cookies` was called outside a request scope ``
  from the fake auth adapter, 9 of 10 auth-flow tests down, the run taking 9 minutes instead of 35
  seconds. Next resolves modules under both spellings of the path, so the request handler and the adapter
  hold different instances of `next/headers`, and `cookies()` reads an AsyncLocalStorage context
  belonging to the other one. **The error names the adapter, which is innocent.** Ruled out in order —
  the change under test (an unmodified clone reproduces), a stale `.next` (a cold worktree passes in
  35s), the Node version (identical on the pinned 24.18.0 and on 24.12.0), duplicate `next` copies (same
  `.pnpm` hash) — before the location itself turned out to be the variable: the same clone fails under
  `/tmp` and passes under `~/dev`. Linux CI never sees it. Generalizable: **when a bug appears only
  outside your usual checkout, suspect the PATH before the code**, and when an AsyncLocalStorage-backed
  API says "outside a request scope", look for two copies of the module in the graph.
- **Renaming a migration is still the trap the notes said it was, and `.data` is still the fix**
  (2026-07-31, `feat/support-desk`). `1001_notes` → `1001_tickets`, `1002_org_requests` →
  `1002_escalations`, `1003_artifacts` → `1003_attachments`: Kysely keys applied migrations by NAME, so
  after a rename it sees three unapplied migrations next to three orphaned records and re-runs them
  against tables that already exist. Wipe `apps/showcase/.data` before the first boot, and run
  `pnpm test:contract` yourself — it is not in `pnpm verify`, and it is the only thing that runs the RLS
  proofs against real Postgres.
- **A blanket `s/request/escalation/` across the e2e suite renames Playwright's own API** (2026-07-31,
  same branch). `page.request`, `context.request` and the `{ request }` fixture all became
  `page.escalation`, and the failure surfaced 40 lines later as `Property 'escalation' does not exist
on type 'Page'`. The house rule already says a codemod is verified by grepping for the old token, not
  by the diff looking right; the corollary this run added is to **write down the words the codemod must
  NOT touch before running it** — `request` was a domain word AND a framework API in the same files.
- **Mantine's `light` badge variant fails WCAG AA for yellow and green** (2026-07-31, same branch). A
  status badge coloured by ticket state (`open`/`pending`/`resolved` → blue/yellow/green,
  `variant="light"`) sailed through review and then failed the axe sweep on nine pages at once, because
  `--mantine-color-yellow-light-color` on `--mantine-color-yellow-light` is around 3:1. The fix was not
  a different shade: the status was already spelled out in the picker beside the row, so the badge was
  redundant decoration carrying a contrast bug. **Check a colour-coded badge against the axe sweep
  before deciding it is worth having** — and prefer text where the same fact is already on screen.
- **A seeded world changes what "the seed baseline" means, and old tests assert the old one**
  (2026-07-31, same branch). Once the seeder sends one email, three specs that asserted `mail-empty`
  after a Backstage reset were asserting the ABSENCE of a feature. They now assert the baseline exactly
  (one message, and not the one the test sent). Generalizable: when you give a demo world an opening
  state, grep the suite for empty-state assertions before running it — they are the tests most likely
  to be quietly measuring "nothing has happened yet" rather than anything you meant.
- **A demo driver that swallows a missing element cannot be a gate** (2026-07-31, `feat/plays`). The
  ghost-cursor engine this repo ported kept a tour alive by ignoring any selector that did not resolve,
  which is right for a viewer (being stranded mid-story is worse than an awkward finish) and useless for
  CI. The port keeps the behaviour and adds a record: every unresolved target becomes a `PlayMiss`,
  shown in the narration bar as it happens and totalled in an end-of-run report the e2e asserts is zero.
  "The play finished" is not evidence; "the play finished having found everything" is.
- **A play is an e2e walkthrough you can also show to people** (2026-07-31, same branch). The showcase's
  play signs in, files an inbound email, assigns the ticket it became, holds the world, watches an
  autonomous actor finish a job, registers a webhook and accepts an escalation — sixteen steps that a
  hand-written spec would have taken as long to write and nobody would ever have watched. Wiring it into
  `pnpm e2e:demo-static` cost one spec that iterates the registry, so a new play needs no test at all.
  It runs in ~11 seconds at rehearsal speed, versus ~5 minutes at presentation speed.
- **Mantine dropdowns close on FOCUS, not on a scripted click** (2026-07-31, same branch). `el.click()`
  dispatches a click and nothing else, so a Mantine combobox left open stayed open when the driver
  clicked another field, and the next step's cursor had to press a button underneath a floating option
  list. The fix was ordering, not machinery: pick the option first, then `type` into the next field —
  the driver's type action calls `focus()`, and the focus change is what closes it. Generalizable to any
  scripted UI driving: **a synthetic click is not a user's click**; if a component reacts to
  mousedown/focus, script the action that really produces one.
- **A pnpm workspace package with no `dependencies` still works — by accident** (2026-07-31, commit-range
  review of `10133fbe..HEAD`). `packages/keel` shipped a 120-subpath `exports` map and a lint rule
  enforcing it, but declared **zero** dependencies while importing 22 external packages. It resolved
  because Node walks up to the workspace root's `node_modules`, which happens to declare them all — so
  the _root_ manifest was silently acting as keel's manifest, pnpm's isolation did not apply to the one
  package that most needed it, and nothing (knip included) could see the gap: a workspace that declares
  nothing has nothing to report as unused. Declaring them fixed it, with one trap below.
- **Declaring a framework package's deps can FORK the singleton it shares with the app** (same review).
  Adding `next-intl` to `packages/keel` as a plain dependency gave keel its own `.pnpm` copy with a
  different peer hash from the apps' — two module instances of a **React-context** library in one bundle,
  which is `NextIntlClientProvider` in one instance and `useTranslations` in the other, i.e. the exact
  failure mode `.claude/future-tasks/resolved/adoption-probe-not-under-tmp.md` documents for `next`. Two things
  fixed it, and both were needed: (1) the host-owned singletons (`react`, `next`, `next-intl`,
  `@mantine/*`) belong in **`peerDependencies`**, not `dependencies`, so the consumer's copy is the one
  that gets linked; (2) keel had to declare `typescript` as a devDependency, because it is an OPTIONAL
  PEER of `next-intl` and its absence from keel's graph alone was enough to change the peer hash. The
  check that actually settles it is not "does it build" — it is comparing `readlink -f` of
  `packages/keel/node_modules/<pkg>` against `apps/<app>/node_modules/<pkg>`; equal realpath, one
  instance. Run it after ANY dependency change to a package the apps also depend on.
- **Recorded paths do not survive the directory rename they describe** (same review). `scripts/init-app.ts`
  collected every file it wrote into a `touched` set, renamed `apps/<old>` → `apps/<new>` as its last act,
  then ran prettier over `touched` — five paths that no longer existed. Prettier reported each one and
  exited 2, so the headline adoption command ended every run with "prettier exited non-zero" while the
  app's own rewritten files went unformatted: the precise outcome the formatting pass was added to
  prevent. Generalizable: **a post-pass over a recorded file list must be re-based whenever anything
  moves under it**, or run before the move.
- **A lint fence is only as wide as its glob, and the framework extraction moved code out from under one**
  (same review). `react/jsx-no-literals` covered `packages/keel/src/components/**`; the extraction then
  gave keel 640 lines of user-visible `demo-static/` UI that no glob matched. Widening it to both sides'
  `demo-static/**` immediately found a hard-coded `'static demo'` badge that had been rendering English
  into the Spanish demo. When a restructure moves code, re-derive which fences still reach it — the
  fences do not follow the code.
- **The real auth adapter returned a membership id where every caller expects a user id, and only
  real Clerk could show it** (2026-07-31, `fix/full-code-review-findings`). `Membership.id` is
  documented as sharing `AuthUser.id`'s namespace — notify exclusion, notification recipients, and
  assignee persistence all compare the two — but `realAuth.listMembers` returned Clerk's membership
  resource id (`orgmem_…`) instead of the member's user id. The fake adapter's persona ids already
  live in one namespace, so every test and demo walk compared equal by accident; the divergence was
  invisible until a real Clerk org was in the loop. Fixed by reading `publicUserData.userId`. **A
  port's doc comment is a claim about every adapter, not just the one you're staring at** — when a
  fake and a real adapter can only diverge on a field the fake happens to make agree with itself,
  the port contract needs a fixture or a contract-test assertion, not just a comment; none exists
  for this one yet (see the `auth-dev` cutover row).
- **A `useState` setter inside a `useCallback` still closes over the render it was created in**
  (2026-07-31, same branch). The plays engine's `end()` read `misses` from the hook's own closure to
  build the run report, but `addMiss` (called from the advance script, not from a render) could add a
  miss on the play's own last step, after `end()`'s closure had already formed — the CI gate that
  asserts the report is empty was reading a report that dropped exactly the miss it existed to catch.
  Mirroring the list in a `useRef` alongside the `useState` (write both, read the ref) fixed it.
  Generalizable: a value a CI gate depends on should be read from something that cannot go stale
  between the write and the read, not from whichever closure happens to be convenient.
- **Pagination is a framework invariant; the table around it is not** (2026-07-31,
  `feat/keyset-pagination`). The capability matrix put a generic list/table kit at the top by demand
  (16/19), and the obvious move was to ship one in keel. It was the wrong move, and working out WHY
  produced a rule the repo was missing: the two shipping tests (universality, new-class) govern vendor
  code, and nothing governed components. The rule that fell out — **does this component encode a
  framework invariant, or is it generic presentation?** — is now a third test in
  `docs/development-approach.md`. It sends the grid to `docs/recipes/list-kit.md` (ADR-0005 already
  named Mantine as the only component library, so a keel `<DataTable>` would be a second source of
  generic components), and it keeps the one part that is genuinely an invariant: a paginated READ of a
  tenant-scoped table, where the cursor is client input and page seven must be scoped exactly like page
  one. Applied retroactively the test validates every screen keel ships without needing an exception,
  which is the reason to trust it rather than merely to like it.
- **The cursor was designed so that "it cannot widen a scope" is structural, not vigilant** (2026-07-31,
  same branch). Two choices do the work. The cursor's grammar carries a POSITION and nothing else —
  `(timestamp, id)`, no tenant, no org, no table — so there is no field with which to name a scope. And
  `keysetPage` opens the `withTenant` transaction itself and re-runs the caller's whole `build` callback
  (org filter included) on every page, so the cursor is only ever an extra AND on an already-scoped
  query, and a conjunct can only remove rows. The classic pagination hole — page one built from the
  session, page two built from the cursor — is not defended against here; it is unrepresentable, because
  there is no second query to write. That is the difference worth copying to the next primitive that
  takes client input.
- **Deliberately breaking a new gate found that one of its four failure modes was invisible on pglite**
  (2026-07-31, same branch). Four sabotage runs against the RLS suites: drop the id tiebreak, mint the
  cursor at millisecond precision, apply the caller's scope only on page one, and let page two escape
  `withTenant`. Three failed immediately. The precision one PASSED on pglite — because pglite's `now()`
  is millisecond-precise while real Postgres's is microsecond-precise, so the fake could not express the
  bug the real engine has. The proof rows were changed to carry an explicit microsecond `created_at`
  instead of relying on `now()`, and the sabotage then failed on both engines. Generalizable: a proof
  that leans on engine DEFAULTS holds the fake and the real thing to different standards, which is the
  one thing the contract suite exists to prevent — and only the deliberate failure run would ever have
  shown it.
- **A `timestamptz` cursor must be rendered by the database, never by a JS `Date`** (2026-07-31, same
  branch). `timestamptz` keeps microseconds; the `Date` every driver hands back keeps milliseconds. Mint
  the cursor from that `Date` and the next page asks for `created_at < …123` while the rows all say
  `…123456`. The rows written inside that millisecond are silently skipped — and since one INSERT is one
  transaction and `now()` is transaction-start time, a bulk-written batch shares ONE timestamp, so page
  two comes back permanently empty. The pager therefore selects `to_char(created_at at time zone 'UTC',
'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` alongside the row and puts THAT string in the cursor. The `at time
zone 'UTC'` is not decoration: pglite's session TimeZone is not UTC, so a bare `to_char` would render
  a different wall clock than the same code does on a server set to UTC.
- **A seed CORPUS change needs the same `.data` wipe a migration change does** (2026-07-31,
  `feat/keyset-pagination`). `appSeedRows` guards the whole corpus with one check — "any ticket at all
  means this world has already been seeded" — which is exactly right for idempotent boots and world
  resets, and means new seed rows are INVISIBLE on an existing `apps/*/.data`. Adding six archive
  tickets and running `pnpm verify` therefore failed one e2e with an assertion about a ticket that the
  code creates and the local world did not have, which reads exactly like a pagination bug and is not
  one. CI never sees it (fresh checkout, fresh world), which is the worst shape for a local-only
  discrepancy. Wipe `apps/*/.data` after touching `packages/seed`, the same reflex the migration rule
  already asks for.
- **A squatting dev server makes your new feature look like it was never written** (2026-07-31,
  `feat/keyset-pagination`). Three `pnpm verify` runs failed on the new pagination specs with symptoms
  that read as real product bugs: page one returned the whole queue, and a malformed cursor returned 200. Both are exactly what the route did BEFORE this branch — because `reuseExistingServer: !CI`
  silently reused a `next dev` on :3000 belonging to ANOTHER worktree's agent session, so the suite was
  driving someone else's build of the app. The tell is in the log and is easy to miss: no `[WebServer]`
  startup lines means Playwright started nothing. The diagnostic that settles it in one step is to
  print the API response body — a field your branch added being ABSENT (not wrong, absent) proves it is
  not your code answering. Escape hatch: a throwaway Playwright config on another port with
  `reuseExistingServer: false`. It works for `tests/e2e` but NOT for two destructive specs
  (`plays.spec.ts`, `access-gates.spec.ts`) which hard-code `http://localhost:3000` instead of reading
  `use.baseURL`, so they must be run separately or the port must genuinely be free.
- **A stale `.next` survives a tree reshape and poisons `pnpm verify` locally** (2026-07-31,
  `feat/keyset-pagination`). `pnpm verify` failed with the starter's dev server refusing to boot —
  `Could not parse module '[project]/src/instrumentation.ts', file not found` — for a file the starter
  has never had. The reference lived in a `.next/dev/server/**` chunk built back when the tree had a
  different shape. `rm -rf apps/*/.next` fixed it. CI cannot hit this (it always checks out clean), which
  is exactly why it is worth writing down: it only bites a developer moving across a branch that changed
  the app layout, and the error names a file that does not exist and never did, so it reads as a missing
  source file rather than a cache. **When a build error names a path that was never in git, clear the
  build cache before believing it.**
- **When e2e failures read like product bugs, check who owns port 3000 first** (2026-07-31, same branch).
  Playwright's `reuseExistingServer` is `!process.env.CI`, so a `next dev` left running by ANOTHER
  worktree's session is silently adopted and the suite drives someone else's build — producing failures
  that look exactly like real defects (a paged endpoint returning the whole queue, a bad cursor returning
  200). **The tell is the absence of `[WebServer]` startup lines in the log**: a run that started its own
  server logs them, a run that adopted one does not. Two follow-ups worth doing: some destructive specs
  hard-code `http://localhost:3000` rather than reading Playwright's `baseURL`, which blocks the
  obvious escape hatch of running on an isolated port.
- **A base64 literal in a test reads to a secret scanner exactly like a committed credential**
  (2026-07-31, `feat/keyset-pagination`). The keyset proofs check that a crafted cursor cannot widen a
  scope, and one case was pasted as `MjAyNi0wMS0wMVQwMDowMDowMFp8JyBPUiAxPTEgLS0` — base64url of
  `2026-01-01T00:00:00Z|' OR 1=1 --`. gitleaks failed the branch on it, correctly: a high-entropy blob
  is a high-entropy blob, and nothing in the file distinguishes an attack fixture from an API key. The
  fix is not an allowlist — it is to **build the envelope from its readable payload**, which also makes
  the test say what it is testing instead of hiding it in an encoding. Note the encoder could not be
  reused: `encodeKeysetCursor` validates and rightly refuses to mint a hostile position, so the proof
  forges the envelope the way an attacker would. General rule: **an opaque literal in a test is a
  smell twice over** — the scanner cannot read it and neither can the next person.
- **`console.log(number)` is not a safe way to print a value another process will parse** (2026-07-31,
  `fix/e2e-port-isolation`). Package scripts now read their port from
  `node scripts/print-port.mjs <service>` via `$(...)`. It worked from a terminal and failed only under
  Playwright, with the maddening `error: option '-p, --port <port>' argument '3240' is invalid. '3240'
is not a non-negative number.` The value really was 3240 — plus `\e[33m` and `\e[39m` around it.
  Playwright injects **`FORCE_COLOR=1`** into every `webServer` process it spawns, and `console.log` of
  a NUMBER routes through `util.inspect`, which colourises numbers. Escape codes are invisible in a
  terminal AND in a log file, so every diagnostic said "3240" while `parseInt` saw `NaN`. **Print
  machine-read values with `process.stdout.write` of a string**; strings are never colourised. The
  general rule: if another process parses it, a human-readable printer is the wrong tool.
- **A config imported by `playwright.config.ts` must parse as CommonJS** (2026-07-31, same branch).
  `scripts/ports.mjs` originally used `import.meta.dirname` to find the checkout root. Playwright
  compiles the config and everything it imports to CJS, where `import.meta` is a **syntax error** — and
  because it fails at config-load time it takes the entire suite with it, before a single test runs.
  `__dirname` is equally unavailable on the ESM side, so shared tooling reached from a Playwright config
  can use neither: locate things from `process.cwd()` instead. The same constraint is why the CLI half
  lives in its own file (`print-port.mjs`) rather than behind an `import.meta`-based entry-point check.
- **The e2e suite's `workers: 1` was blamed on memory for months; it is actually a shared-world
  problem** (2026-07-31, same branch). The config said "the dev VM has 10GB RAM; parallel Chromium
  renderers get OOM-killed". Measured on a 10-core/64GB machine, where memory cannot bind, flakes still
  scaled monotonically with parallelism over the same 56 tests — 0 flaky at 1 worker, 1 at 2, 2 at 3, 2
  at 4 — and at 5 workers the world corrupted outright (`Unexpected non-whitespace character after JSON
at position 751` on an 821-byte `invites.json`: two non-atomic `writeFileSync` calls interleaving).
  Every worker drives ONE dev server holding ONE `.data`. The repeat offenders were the specs that write
  shared state, one of which is `tenancy.spec.ts` — **the same test this file already recorded as a
  recurring CI flake**, because CI runs the default worker count. Two lessons. First, **a plausible
  cause written into a comment outlives the evidence for it**: nobody re-tested the memory theory on a
  bigger machine, and it silently became the reason not to try. Second, **parallelism is only safe where
  the worlds are separate** — hence CI now shards across runners (separate machines, separate `.data`)
  rather than raising `workers` inside one. Full write-up and the fix order in
  `.claude/future-tasks/e2e-shared-world-blocks-parallelism.md`.
- **Next refuses a second `next dev` per project directory, whatever port you give it** (2026-07-31,
  `fix/e2e-world-isolation`). Local e2e sharding — one dev server and one `.data` per shard, which is
  the only safe way to parallelise this suite — was built and died immediately: `⨯ Another next dev
server is already running`, naming the PID of a sibling shard. The lock is per-DIRECTORY, kept under
  `.next/dev/`, so distinct ports and distinct `APP_DATA_DIR`s are not enough; all shards share one
  `.next`. Two ways past it, and the cheap-looking one is worse: a per-shard `distDir` separates the
  lock but makes every shard pay its own cold compile, whereas sharding against the PRODUCTION build
  (`E2E_BUILD=1`, `serve-standalone.mjs` — a plain `node server.js` with no dev lock at all) shares one
  build across every shard. Written up in `.claude/future-tasks/local-parallel-e2e.md`.
- **The standalone server writes its world INSIDE the build output, where `rm -rf .data` cannot see
  it** (2026-07-31, same branch). The fake adapters resolve `.data` from cwd, and
  `scripts/serve-standalone.mjs` runs `node server.js` with cwd set to the nested
  `.next/standalone/…/apps/<app>` directory — so the world landed there, survived every reset, and
  leaked state between runs. It cost two production-build e2e failures that read exactly like product
  bugs (a continuity test seeing a persona it had already switched; a held-job test seeing a previous
  run's job) before anyone looked at where the JSON actually was. The script now pins `APP_DATA_DIR` to
  the app's own `.data` unless the caller sets one. General shape of the lesson: **when a process's cwd
  is not where you think, every cwd-relative path silently moves with it** — and a reset that targets
  the visible copy then reports success while changing nothing.

## keel's test fixture app (2026-07-31, `feat/keel-test-fixture-app`)

- **Two narrow `knip.json` ignores, and why each is the narrowest form.** `packages/keel` now analyses
  `test-fixture/**` as well as `src/**`, which caught real dead code in the fixture (an unnecessary
  `appJobHandlers` export and four unused seed type re-exports — both fixed rather than silenced). Two
  things it cannot see the point of, so they are ignored by path:
  `test-fixture/api/**` (thirteen route files that are READ AS TEXT by
  `authorized-mutations.test.ts` and imported by nothing — declaring them entries would then have knip
  demand a consumer for each exported `POST`, since the workspace runs `includeEntryExports: true`) and
  `test-fixture/app-config/db/migrations/*.ts` (`up`/`down` are reached by Kysely through the composed
  registry object, the same reason the framework's own `src/db/migrations/0*.ts` is ignored). The
  showcase workspace also gained `scripts/**` to its `project`/`entry`, because `llm-record.ts` moved
  into the app; without it that file would be unanalysed and its imports would stop counting as usage.
- **`new URL('…', import.meta.url)` is not portable across vitest environments.** In the `happy-dom`
  environment the global `URL` is happy-dom's, and resolving a relative reference against a `file:`
  base does not produce a `file:` URL — `fileURLToPath` then throws `The URL must be of scheme file`,
  at module load, so the whole suite reports "0 test" rather than a failed assertion.
  `import.meta.url` itself IS a proper `file://` string there. Use
  `path.dirname(fileURLToPath(import.meta.url))` and `path.resolve` from it.
- **`exclude` in a tsconfig does not stop a file being compiled — an import does.** The root program
  excludes `apps`, yet `scripts/llm-record.ts`'s relative import of the showcase's `app-config` pulled
  that app's seam in and typechecked it against whatever `@app-config/*` the ROOT resolved. That was
  invisible while the root alias pointed at the same app; repointing it at the fixture surfaced ten
  errors in a file nobody thought was in the program. If a root-level script imports app code, it is
  app code — move it into the app.
- **Comments are safe in `tsconfig.json` here.** Prettier's JSON parser preserves them and `knip`
  reads JSONC, and `scripts/init-app.ts` edits that file with literal string replacement rather than
  `JSON.parse`/`stringify` (unlike `knip.json` and the `package.json`s, which it round-trips and where
  a comment WOULD be dropped). Verified with `prettier --check` before relying on it.
- **A framework STORY can leak app vocabulary past every fence.** `simulator.stories.tsx` passed
  `actor="bundle-analyzer"` to `ActorShell`, whose prop is typed to the seam's `ActorId`. No lint rule
  covers it, and each app's tsconfig EXCLUDES `packages/keel/src/**/*.stories.tsx`, so the only program
  that ever typechecked it was the root one — which happened to resolve the seam to the app that
  defined that id. It now uses a neutral placeholder with one documented cast, because no literal can
  be valid under a seam that registers no actors at all.

## Pre-publication review (2026-08-02)

_Lessons from the review passes run against the squashed publication artifact, before this repo
was public. They are here rather than thrown away because most of them are about how gates fail
quietly, which is not specific to publishing._

- **`.github/` is a blind spot no gate looked at, and it broke in the house failure mode.** Both issue
  forms shipped with `value:` directly on the `- type: markdown` body item instead of under
  `attributes:`. Valid YAML, invalid schema — so GitHub refuses to render the form and the entire
  structured issue funnel would have been dead on day one. This is the third instance of the same
  class here: the workflow that parsed fine but declared `runner.temp` in a job-level `env:` and ran
  zero jobs, and a valid-but-wrong doc citation. **A file's syntax being valid says nothing about the
  consumer accepting it, and the consumer for `.github/` is not in this repo.**
  `tests/docs/issue-forms.test.ts` now walks each form's `body:` items and fails any content key
  written at item level. It is deliberately a line walk, not a schema validation: adding a YAML parser
  or fetching SchemaStore would cost a dependency or the network, and `pnpm dev` stays hermetic. The
  test says so in its own doc comment — it catches the bug class it was written for and does not
  replace reading the rendered form once on the published repo.
- **A negative control built from a vendor's published example value can be allowlisted by the tool
  you are testing.** Planting AWS's published sample access key (`AKIAIOSFODNN7EX…`) to prove gitleaks works produced "no leaks found"
  — because gitleaks stopword-allowlists `EXAMPLE`. For a minute that read as "the secret scan is
  broken". Build controls from values that look real, not from documentation samples.
- **`tsx` transforms as CommonJS unless a `package.json` says otherwise, and top-level `await` then
  fails at transform time.** `scripts/init-app.ts:798` already carried the note and the `main()`
  wrapper; `apps/showcase/scripts/llm-record.ts` did not, so `pnpm llm:record` — the command the
  `llm-key` cutover row names as its own proof — died in esbuild before reaching its own friendly
  "ANTHROPIC_API_KEY is not set" message. Nothing covers it: `verify` never runs it, `tsc` does not
  care about top-level await, and knip sees a legitimate entry point. If a script is invoked by `tsx`
  from a CJS package, its work goes in `async function main()`.
- **An app-specific fact can hide in the framework catalog as a NUMBER.** keel's
  `simulator.snapshotsResetHint` promised a reset "back to the five seed people". The showcase seeds
  six, the starter two; only keel's own test fixture has five. The dedicated sweep that removed
  app-specific copy from the framework catalog (`resolved/app-kind-copy-in-framework-catalog.md`)
  missed it because a count does not look like a product name, and no gate can: `jsx-no-literals` sees
  a translated key and the en/es parity test only proves both catalogs are wrong identically. It also
  shipped inside `dist-demo/index.html` in both locales.
- **Extension-less coverage globs hand v8 non-source files.** `include: ['apps/*/src/**', …]` made
  every CI run of `test:coverage` print two esbuild parse-error stack traces from
  `src/adapters/README.md` and `src/ports/README.md` while still exiting 0 — noise that looks exactly
  like a real failure and trains people to skim past it. Bind the extension.

- **A raw control character in a source file makes git treat it as binary, and that hides the file
  from every text tool you audit with.** `keyset.test.ts` had a literal NUL where `\x00` was meant —
  one byte, inside a test asserting that a keyset cursor carrying a NUL is rejected. Consequences:
  `git diff` renders it as `Bin 12053 -> 12074 bytes, 0 insertions(+), 0 deletions(-)` so a reviewer
  gets no line diff and GitHub allows no inline comments on it, and — the sharp end — **`git grep`
  skips it entirely**. It was the only such file in the repo, and it silently sat outside four
  consecutive residue/token sweeps that all used `git grep` or `git ls-files | xargs grep`. A sweep
  is only as complete as the file list its tools will actually read. `git grep -I --name-only -e ''`
  against `git ls-files` names any file with this problem in one command; the fix was three
  characters, and the base64 fixture is byte-identical either way (`…YQBi`).
- **When you write a gate for one bug, enumerate how the consumer rejects the file — not just how it
  broke this time.** Round four's new `issue-forms` gate caught the defect that shipped and missed
  two others GitHub also rejects outright: a duplicate body-item `id` (the copy-paste mistake) and a
  missing top-level `name:`/`description:`. Neither needed the YAML parser or network the gate's own
  doc comment cites as its reason for stopping where it did — the stated limit was real but it had
  been drawn in the wrong place. It also hard-coded a 4-space attribute indent, so a perfectly valid
  2-space form would have failed with a misleading message. All four classes are now proved red then
  green, including a 2-space form proved to pass while still failing when broken.
- **A scaffold doc that says a file "needs no change" is a claim, and it can be false silently.**
  `/new-actor` said the page and `actor-host.tsx` are generic. Both hosts in fact select a driver by
  actor id (`actor === 'bundle-analyzer'` in the live app, the same ternary in the static twin), and
  an unregistered id falls through to the other actor's behavior rather than erroring — so a third
  actor added exactly as documented renders someone else's driver while typecheck, lint, knip and the
  whole unit suite stay green.
- **Fork-and-merge distribution has a precondition, and GitHub's "Use this template" button violates
  it.** ADR-0013 makes `git merge upstream/main` the entire update mechanism. A repo created from the
  template button (or a downloaded archive) has an unrelated root commit, so that merge dies with
  `fatal: refusing to merge unrelated histories` **even though the trees are byte-identical**.
  Reproduced both paths side by side: template exit 128, clone exit 0. This is why keel is published
  as an ordinary public repo and deliberately NOT marked as a GitHub template repository, and why the
  recovery (`--allow-unrelated-histories`, once) is written down where an adopter will find it.
- **A `CONTRIBUTING.md` can be locally accurate and still point contributors at rejected work.** Ours
  gave an unconditional four-step how-to for adding a vendor adapter, which is exactly what
  `docs/recipes/sms-twilio.md` is a written _rejection_ of, and never mentioned the two tests, the
  recipes directory, how to open a PR, or that four gates are CI-only. The tests are decidable before
  writing code; not saying so is what makes a contribution expensive.

The lens was "attack what `SECURITY.md` promises". The cryptography held — RS256 pinned at verify time
so `alg:none` and an RS256→HS256 downgrade are both rejected, audience checked, `maxTokenAge` bound to
`iat` so a ten-year `exp` does not help, constant-time signature comparison with a length pre-check,
9/9 malformed keyset cursors rejected with 400, the production guard genuinely refusing to build. What
did not hold was **enforcement of coverage**, twice, in the same shape.

- **A security claim containing the word "every" needs a catalog query, not a list.** `SECURITY.md`
  said every tenant-scoped table is protected by RLS; what existed was a hand-written proof suite
  somebody had to remember to extend. A DELIBERATELY SABOTAGED table — created the way
  `/new-entity` describes but with its six-line RLS block removed — passed typecheck, lint, knip and
  all 724 unit tests **while permitting a cross-tenant SELECT and a cross-tenant INSERT through
  `db.withTenant()`** — demonstrated, not argued. No shipped table was ever unprotected: the hole was
  in the GATE, not in the schema. `packages/keel/src/db/rls-coverage.ts` now reads `pg_class`/`pg_policy` after migrations run,
  on both engines, so an adopter's own table is covered with nothing to register. The check asserts it
  found more tables than it exempts, because a catalog query that matches nothing passes every
  assertion vacuously — the "gate that has only ever passed" failure mode, applied to itself.
- **A property can be structurally invisible to the test shape you already have.** `FORCE ROW LEVEL
SECURITY` appears in thirteen migrations and was asserted by nothing, on either engine. Deleting it
  from `tickets` left pglite AND real Postgres green. The reason is not carelessness: every
  behavioural proof runs through `runWithTenant`, which does `SET LOCAL ROLE app_user`, and `app_user`
  is not the table owner — so `FORCE` cannot matter on the only path the proofs use. It protects the
  OWNER connection, and on real Postgres with a non-superuser owner, a table without it hands that
  connection every tenant's rows. **When a test suite has one entry path, ask what that path makes
  unobservable.**
- **A scan's root was narrower than the framework's routing.** `authorized-mutations.test.ts` walked
  `src/app/api`, but Next serves `route.ts` from anywhere under `src/app`. A mutating handler at
  `src/app/[locale]/danger/route.ts` was scanned by nothing and answered 200 to an unauthenticated
  POST. Latent rather than live — all 113 route files here are under `api/` — but the scan exists for
  the route somebody adds later. The walk now starts at `src/app` while exemption paths stay measured
  from `api/`, so the map did not have to be rewritten and a non-api route resolves to a `../`-prefixed
  path that no exemption key can match. Legitimate non-api handlers (`sitemap.xml/route.ts`) are
  scanned rather than banned.
- **Fixing a parser bug introduced a second one, and only testing the fix caught it.** Widening the
  issue-form gate to recognise an item by its dash rather than by `type:` made every `options:` entry
  under a `checkboxes` item parse as a malformed body item. It surfaced on the first re-run because
  the probe suite included the shipped forms as a control. Anchor a list walk to the list's own dash
  column, and keep a known-good case in every probe set.
- **An ESLint selector bans a shape, not an act.** `CallExpression[callee.property.name="getDb"]`
  catches `db.getDb()` and misses `const { getDb } = db; getDb()`. The ban now fires at the
  destructuring, because binding the raw handle out of the port is the act worth refusing.

Round seven's job was to attack the coverage gate round six had just built. It got past it four ways,
and the shape of every one is the same lesson in a different costume.

- **A naming convention is not a mechanism — including when the convention is yours.** Round six's
  gate asked "does this table have a column named `tenant_id`". A table keyed on `org_id` instead
  (an org belongs to exactly one tenant, so it is tenant-scoped in fact), a table in a schema other
  than `public`, and a VIEW over a protected table each fell outside that question and each leaked —
  the first demonstrated in the real adopted artifact with `pnpm verify` exiting 0. The irony is
  exact: the gate built to replace a convention with a mechanism was itself keyed on a convention.
  It now asks the question that needs no convention to be true — **can `app_user` reach this
  relation?** — over every schema and every relation kind. That one predicate closed all four doors,
  and it was measured clean on the shipping schema before it was trusted, so it is not a noisy gate.
- **"A policy exists" is not "a policy isolates".** The check accepted any policy, so
  `USING (true) WITH CHECK (true)` — RLS enabled, forced, and isolating nothing — passed. It now
  reads the policy expression via `pg_get_expr` and requires it to mention `app.current_tenant`.
  Narrow misconfigurations were checked too and fail closed on their own: a `FOR SELECT`-only policy
  rejects cross-tenant writes, and a policy attached `TO` another role returns nothing.
- **A count is not a shape.** The sanity floor was "more rows than exemptions" — three. A
  deliberately broken catalog query that happened to retain the three exemption names sailed past it
  while a shipped table had no RLS at all, and the only thing that noticed was the hand-written
  behavioural proof the gate exists to replace. The floor is now a named list of framework tables
  that must appear.
- **`has_table_privilege` reports table-level privileges only.** A column-level
  `GRANT UPDATE (name) ON tenants` let `app_user` rewrite every row of the tenant registry while the
  SELECT-only assertion reported nothing, and `TRUNCATE`/`REFERENCES` were simply not in the list.
  The check now reads the ACLs themselves (`aclexplode` over `relacl` AND `attacl`) for every
  privilege other than `SELECT`. `SECURITY.md` had been updated in round six to claim this assertion
  — the second time that file promised more than the check behind it, which is worth noticing as a
  pattern rather than as two incidents.
- **A false positive is a security bug when the documented escape is an exemption.** A correctly
  protected partitioned table failed the gate, because Postgres applies policies on the parent while
  the check flagged the partitions. The only lever an adopter had was adding those partitions to the
  exemption list — a false positive that pushes people toward widening the hole. Partitions are now
  skipped and the parent is checked.
- **An ESLint selector bans a shape, not an act — twice over.** After round six closed
  `const { getDb } = db`, three forms still worked: `db.getDb.bind(db)`, `db['getDb']()`, and
  destructuring in a function parameter. Matching `MemberExpression[property.name="getDb"]` plus a
  computed-key form plus a parameterless `ObjectPattern` ancestor catches five of six probed shapes.
  The sixth — a variable computed key — gets through, and no selector can chase an arbitrary alias:
  a linter narrows the easy paths, and RLS in the database is the boundary.
- **A precondition no local gate can check belongs in the cutover checklist.** RLS, `FORCE`
  included, is bypassed outright by a role holding `SUPERUSER` or `BYPASSRLS`, and `infra/stack.ts`
  wires `DATABASE_URL` to the cluster's master credentials — so the app connects as the table owner
  and `FORCE` is the only thing left. Neither pglite nor the contract suite can see the deployed
  role, so no test will ever catch this. New row `db-role-not-superuser`, and a paragraph in
  `SECURITY.md` saying so plainly.

The seven passes before this one were each handed a "dead ends — do not investigate" list, and each
inherited the previous one's. That is an untested assumption chain, and it had already been shown to
have a hole: four passes declared the residue sweeps clean before one of them discovered a stray NUL
byte had made a source file binary to git, so `git grep` had silently skipped it in every sweep. This
pass got no exclusion list; prior claims were handed to it as hypotheses to re-derive.

- **The scrub is finished, and this time that conclusion was re-derived rather than inherited.**
  Every token swept case-insensitively with `[^A-Za-z0-9]` boundaries and multi-line, over a file list
  first proved complete (773 tracked, 773 readable as text). Then, more usefully, a candidate list
  derived FROM the tree rather than from the inherited one: every rare capitalised multi-word phrase
  and every all-caps 2–6 letter token, read individually. Zero hits. The built single-file demo — the
  artifact README tells you to email to someone — was swept too, not just the source.
- **"Can `app_user` reach this relation?" was still keyed on a convention, one level down.** The
  predicate matched grants written DIRECTLY to `app_user` or to `PUBLIC`. Postgres privileges pass
  through role MEMBERSHIP, so `GRANT SELECT ON t TO reporter; GRANT reporter TO app_user;` leaves
  `aclexplode` reporting `reporter`, the relation invisible to the check, and a cross-tenant read
  available through `db.withTenant()` — demonstrated, with the gate green. `pg_has_role` asks the
  transitive question. **Three passes running, this same check was fixed by widening what "reachable"
  means; each time the previous fix had replaced one convention with another.** The `grantee = 0` arm
  has to stay alongside it, because that is `PUBLIC` and `pg_has_role` does not cover it.
- **A directory excluded from the type program is excluded from more than typechecking.** `infra/`
  and `spikes/` are outside the root tsconfig, knip and jscpd, so ESLint was the only gate reaching
  either — while `infra/README.md` names `synth` as its verification bar and `docs/provenance.md`
  cites the spike as the harness that de-risked ADR-0004. Both were healthy when checked, so this was
  a missing guard rather than rot, but it is the same shape as the framework-relocation rot that
  `infra/` had already suffered once. Both now run in CI.
- **A draft is still a template.** `infra/` is honestly labelled a draft you take over, and it shipped
  a Lambda Function URL with `authType: NONE` behind CloudFront. CloudFront in front of an origin does
  not protect the origin: the URL answers anyone who has it, so any WAF, geo restriction or rate limit
  attached to the distribution later is bypassable by calling the origin — and the stack published the
  URL as an output. Now `AWS_IAM` plus `FunctionUrlOrigin.withOriginAccessControl`, verified in the
  synthesized template (`AuthType: AWS_IAM`, a `lambda`-type OAC signing `always`/`sigv4`, and a
  `lambda:InvokeFunctionUrl` permission scoped by `SourceArn` to this distribution — checking that
  last one matters, because setting `AWS_IAM` without it locks out CloudFront too). Adopters copy IaC
  more faithfully than any other file in a repo.
- **A lint rule bans shapes; say so rather than claiming it bans the act.** The `getDb` selectors
  catch five of six probed evasions — a variable computed key (`const k = 'getDb' as const; db[k]()`)
  still walks past, and no selector can chase an arbitrary alias. The previous note here claimed all
  six. The rule is a fast local reminder; RLS in the database is the boundary.
- **The number that drifted was the one with no gate.** `public-surface.test.ts` regexes the
  "126 published subpaths" figure out of `CLAUDE.md` and fails if it is wrong — and 126 was right in
  all three places it appears. Its complement, "the other 33 modules are internal", was ungated and
  was 34, in three files. A gate on half a derived pair is a gate on half a derived pair.

## `keysetPage` alternate ordering (2026-10-03, `feat/upstream-date-storage-keyset`)

- **A literal `orderBy` next to an inline arrow `build` makes TypeScript abandon `TB`, and `NoInfer`
  does not help.** `keysetPage(db, req, (trx) => trx.selectFrom('dockets')…, 'last_touched_at')` fails
  to typecheck: `build`'s return type is rejected against `SelectQueryBuilder<DB, KeysetTableName, …>`
  and `O` collapses to `{ id: string }`. The checker has to resolve `KeysetOrderColumn<TB>` to test the
  literal, which happens before the context-sensitive arrow (untyped `trx`) is read, so `TB` is fixed
  at its constraint. Typing the parameter (`(trx: Transaction<DB>) => …`) or passing a named `build`
  restores inference, and a nullable, missing or other-table column is then rejected naming
  `KeysetOrderColumn<"dockets">`. Wrapping the parameter in `NoInfer<TB>` produced byte-identical results
  in all three shapes (tsc 5.9.3), so it is not used. The type-level assertions are in
  `packages/keel/src/db/keyset.test.ts`.
- **"Is a timestamptz" is a runtime guarantee, and it holds.** The schema has no nominal timestamp
  type, so `KeysetOrderColumn` cannot exclude a text column; pointing the proof at `dockets.label`
  failed on the first page with `function pg_catalog.timezone(unknown, text) does not exist`, from the
  `to_char(… at time zone 'UTC', …)` cursor render. A wrong-typed key errors, it does not mis-order.
- **The proof only counts because the tie and the two orderings disagree.** Three sabotage runs, each
  red on both pglite and real Postgres: ordering by `created_at` regardless of `orderBy` (first row
  wrong), comparing on `created_at` while ordering by the alternate column (the walk never
  terminates), and rendering the cursor from `created_at` (the walk stops after 3 of 6 rows). That
  needs a row that is oldest by one column and newest by the other, and a tie wider than the page
  size.
