# ADR-0014 — keel ships as versioned packages: the framework, its fences and its scaffold

- Status: Proposed
- Approver: JP Slavinsky
- Date: 2026-11-17
- Supersedes, if accepted: [ADR-0013](0013-upstream-updates-fork-and-merge.md)

## Context

[ADR-0013](0013-upstream-updates-fork-and-merge.md) chose to keep keel publishable-shaped and to distribute it
by fork and merge, and it named four triggers that would reopen the question. The first has fired: **a second
real app outside this repo.** The SafeInsights sharing site (`safeinsights/pages`, app slug `console`, one
tenant per deployment, AWS Lambda with Aurora through the RDS Data API) adopted keel by fork this week.

Its first days measured where a fork's cost lands, and it is not where ADR-0013 expected.

**The adopter fixes were mostly merge friction.** Each of these keel PRs fixed something that broke or
conflicted only because an adopter carries keel's whole repository:

- #39: docs merged in from upstream cited `apps/showcase` and `apps/starter`, which an adopted tree no longer
  has, and turned the adopter's doc-path gate red (ADR-0013's addendum).
- #31: the adopter-identity test had to learn to run in an adopted repo.
- #51: `getDb` exceptions moved out of `eslint.config.mjs` into each app's own `lint-exceptions.mjs`. A path
  written in keel's config named the app's directory, which `pnpm init-app` renames, and every upstream change
  to that file conflicted with the adopter's edit.
- The two dated records, `docs/decision-log.md` and `docs/build-notes.md`, are append-only, so keel and the
  adopter both append at the same end of the same file, and a three-way merge conflicts whenever both did.
  The cutover checklist, `CLAUDE.md` and `LICENSE` are likewise one file that both sides own.

**What the fork actually diverged on, measured.** Pages' `main` (771ca2c) was compared blob by blob with
keel's `main` (3d9b96a), read-only through the GitHub API:

- **`packages/keel`: 266 files.** 221 are identical. The other 45 are older versions of keel's own files,
  and every one of them is a blob in keel's repository. **None is Pages' own.** The package boundary held
  exactly: Pages has never edited keel.
- **Everything outside `apps/`, `packages/` and the lockfile: 176 files.** 85 are identical, 22 are older
  keel versions and 4 are Pages' own. **65 differ from every version keel has ever had**: `init-app`'s
  rewrites plus Pages' own edits. Each is a file where any later keel change conflicts.

So the framework already travels like a package. The scaffold is what a fork cannot carry. ADR-0013's other
point stands, and it is the constraint any answer has to meet: keel is also scaffolding (the verify gate, the
lint fences, CI, infra, the `apps/` layout, the doc doctrine, the agent commands), and `pnpm add` does not
deliver scaffolding. Publishing only `packages/keel` would fix the half that already works and leave the
65-file half where it is.

## Decision

**keel is distributed as versioned 0.x packages, and the scaffold becomes packages too, so that an adopter's
repository holds their app and a thin layer of config that imports keel's.** This repository stays the monorepo
where the packages are built. `apps/showcase` and `apps/starter` stay as the two consumers that every release
must compile and pass against.

| In a fork today                                                | Becomes                                                   | Delivered as                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/keel`                                                | the framework, plus a conformance kit at `keel/testing`   | `@<scope>/keel`, still imported as `keel/…` (open decision D2)        |
| the fences in `eslint.config.mjs`                              | an ESLint plugin with an app preset                       | `@<scope>/eslint-plugin-keel`                                         |
| root `tsconfig.json`, the Next/Vite/Vitest configs, `scripts/` | a tsconfig base, config presets and a `keel` CLI          | `@<scope>/keel-tools`                                                 |
| `infra/`                                                       | CDK constructs                                            | `@<scope>/keel-cdk`                                                   |
| `pnpm init-app <slug> --eject-showcase`                        | a generator whose template is `apps/starter`              | `@<scope>/create-keel-app` (`pnpm create @<scope>/keel-app`)          |
| `.claude/commands`, `.claude/agents`, `CLAUDE.md`'s rules      | a Claude Code plugin, and an app guide inside the package | a plugin marketplace in this repo; a markdown file in `@<scope>/keel` |
| `.github/workflows/checks.yml`                                 | a reusable workflow the app's own workflow calls          | `jpslav/keel/.github/workflows/…@<tag>`                               |

The rules that come with it, each argued in the hard parts below:

1. **The seam becomes a package the app provides** (part 1, option C). Its specifier is renamed from
   `@app-config/*` to `@<scope>/app-config/*`. Nothing else about ADR-0012's seam changes.
2. **0.x ships TypeScript source** (part 2), with a published-files allowlist and a tsconfig base the app
   extends.
3. **All the packages are versioned in lockstep**, one number for the set (part 10).
4. **The two-consumer rule stays and gains a third check, pack and consume**: every package is packed and
   installed into a generated app outside the workspace, and that app's verify must pass (part 7).
5. **Pages switches from fork to dependency once, early** (part 11). New adopters start from
   `create-keel-app`. Fork and merge ends when Pages has switched.

Everything ADR-0013 required of a publishable shape stays required, because it is now the package's contract:
the explicit `exports` map, private-by-default modules, zero host escapes, two consumers.

## The hard parts

Each answer below was settled with a spike. A throwaway consumer was built **outside** the workspace as a copy
of `apps/starter`, and keel was installed into it as a **packed tarball** (`pnpm pack` in `packages/keel`),
never through `workspace:`. The spike app is not committed. Every number here comes from it unless it says
otherwise. The spike packed keel at 3d9b96a, before #46, #49, #51 and #52 merged; counts of this repository's
own files are taken at 6d67a7c, after them.

### 1. The seam

**The question.** keel's source imports the app's registrations as bare `@app-config/*` specifiers: 32 source
files import 18 seam modules, and 27 of those files import values, not only types. Whatever runs keel has to resolve those to the app's
`src/app-config`. Inside this repo, aliases do it: tsconfig `paths` in each app, an alias per app project in
`vitest.config.ts`, and an alias in each demo's vite config.

**Option A: ship source, and alias the seam in every tool, wrapped in presets.** The spike kept keel's
specifiers unchanged and gave the consumer the aliases.

| Tool                                              | A: an alias in each tool                                                                                                                  | C: a package the app provides |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `tsc`                                             | works: tsconfig `paths` apply to keel's files in `node_modules`                                                                           | works, no `paths`             |
| `next build` (Next 16, Turbopack)                 | works: `transpilePackages: ['keel']` and tsconfig `paths`                                                                                 | works                         |
| Vite (the static demo)                            | works: `resolve.alias` applies inside `node_modules`                                                                                      | works, no alias               |
| Vitest                                            | works: keel's `.ts` is transformed with no `server.deps.inline`, and the alias applies                                                    | works, no alias               |
| esbuild (CDK's `NodejsFunction`, so the migrator) | **fails**: `Could not resolve "@app-config/db/migrations"`, with or without `--tsconfig`. `--alias:@app-config=./src/app-config` fixes it | works, no alias, no tsconfig  |
| tsx (a job runner, a script)                      | **fails**: `Cannot find module '@app-config/db/migrations'`, and tsx has no alias option                                                  | works                         |

esbuild and tsx do not apply tsconfig `paths` to files under `node_modules`. Inside this workspace that never
showed, because `node_modules/keel` is a symlink whose real path is `packages/keel`, outside `node_modules`. So
under A, every tool that loads keel needs its own alias, the presets have to know every one of them, and the
first runner nobody wrapped fails. The alias can also point at the wrong seam without failing at all. That
happened on `main` today: `infra/stack.ts` bundles the migrator with the root `tsconfig.json`, whose `paths`
send `@app-config/*` to keel's test fixture. Bundled the same way, the migrator carried the fixture's three
`dockets` migrations and none of the showcase's. It was reported and is being fixed in its own PR.

**Option B: a runtime registry, with module augmentation for the types, shipping compiled JS.** Against three
real seam modules (`jobs`, `identity` and `abilities`) it looks like this:

```ts
// keel/app (B)
export interface KeelAppTypes {} // the app augments this
export interface KeelApp {
    identity: { slug: string }
    jobs: { kinds: readonly string[]; handlers: Record<string, JobHandler>; serviceManagedOrgSlugs: readonly string[] }
    abilities: { staffOrg: string; rules: AppAbilityRules; machineRules: MachineAbilityRules /* … */ }
    // …and the other fifteen seam modules
}
let registered: KeelApp | undefined
export const defineKeelApp = (app: KeelApp) => (registered = app)
export function keelApp(): KeelApp {
    if (!registered) throw new Error('keel: defineKeelApp() has not run in this process')
    return registered
}

// the app's keel.config.ts
declare module '@<scope>/keel/app' {
    interface KeelAppTypes {
        jobKind: 'export-tickets'
        subjectType: 'Ticket' | 'Escalation'
    }
}
export default defineKeelApp({ identity: { slug: APP_SLUG }, jobs: { kinds: ['export-tickets'], handlers }, … })

// keel/core/jobs: the type comes from the augmentation, the value from the registry
export type JobKind = FrameworkJobKind | KeelAppTypes['jobKind']
export const isJobKind = (v: string): v is JobKind =>
    FRAMEWORK_JOB_KINDS.includes(v) || keelApp().jobs.kinds.includes(v)
```

What B costs:

- **It reverses ADR-0012**, which rejected exactly this: "No dependency injection, no TypeScript module
  augmentation, no runtime registration calls", because dynamic wiring is unverifiable by the compiler and
  augmentation hides the extension point from the place it is used.
- **Every module-scope read of the seam becomes a call.** Today `WEBHOOK_SIGNATURE_HEADER` and
  `SERVICE_JWT_AUDIENCE` are exported constants built from `APP_SLUG` when the module loads, and so is the fake
  auth adapter's cookie name. Under B each becomes a function, which changes keel's public API.
- **A missed registration fails at run time, not at compile time.** Every entry point must call
  `defineKeelApp` before keel is first touched: the Next server, the proxy, the static demo, Vitest's setup,
  the migrator, the job runner and every script. The one that forgets throws on first use.
- **One registry object drags its references into every bundle that imports it.** ADR-0012 records the
  static-demo trap: importing one seam registry into the demo bundle grew the single-file demo 37%. Per-module
  seam imports are what let the demo take `presets` without `jobs`' handler graph.

What B buys is compiled JS with no resolution step. Option C turns out to buy that too (part 2).

**Option C: the seam is a package the app provides.** The spike renamed the specifier in a copy of keel
(`@app-config/` to `keel-app/`, 49 files with tests), declared `keel-app` as a peer, and gave the consumer
`"keel-app": "link:./src/app-config"` plus a `package.json` in `src/app-config`:

```json
{
    "name": "keel-app",
    "private": true,
    "exports": { "./db/migrations": "./db/migrations/index.ts", "./*": "./*.ts" }
}
```

pnpm linked the peer into keel's own `node_modules`, pointing at the app's `src/app-config`, and every tool
resolved it through ordinary package resolution, with **every** `@app-config` alias removed: `tsc`,
`next build`, Vite, Vitest, esbuild with no alias and no tsconfig (the migrator bundle held the app's
`1001_items`), and tsx. It also keeps ADR-0012's seam as decided: plain modules, imported directly, checked by
the compiler, one module per capability.

What C costs:

- **The rename.** `@app-config/db/migrations` parses as a package named `@app-config/db`, so the seam has to
  become ONE package with subpaths: `@<scope>/app-config/*`. It is a codemod across keel's source, tests and
  fixture, both apps' aliases, the lint fence and the docs.
- **A two-line `package.json` in each app's `src/app-config`, and a `link:` dependency.** `create-keel-app`
  writes both.
- **The name must sit in a scope keel owns.** In the option-C consumer, `pnpm add` requested `keel-app` from the
  npm registry (404). An unscoped seam name that somebody else later published could install a stranger's
  package where the app's registrations belong. Marking the peer optional in `peerDependenciesMeta`, so that
  pnpm never installs it on its own, is the intended second guard. The spike did not test it, so step P1 must.
- **Inside this repo, nothing about resolution changes.** A bare specifier resolved from `packages/keel` can name
  only one app, which is ADR-0012's reason for one Vitest project per app. So the per-app aliases stay, with the
  new key, and decide it here exactly as now.

**Answer: C for 0.x.** It is the only option under which no tool needs to be told where the seam is. What would
move us to B: keel needing more than one app in one process or one build, a consumer whose toolchain cannot
link a local package, or registrations that must arrive at run time (per-tenant plugins). None of these exists.
If accepted, ADR-0012 gets an addendum recording the new specifier.

### 2. Source versus compiled

**What the spike showed.**

- **The web Lambda does not care.** `next build` with `output: 'standalone'` bundled keel completely: no keel
  file and no `.ts` file is in `.next/standalone`, and `pg` and pglite are traced as externals.
- **Every tool keel runs under can transpile it from `node_modules`**: `tsc`, Turbopack, Vite, Vitest, esbuild
  and tsx (the table in part 1, under C). **Plain Node cannot**: Node 24.19 refuses with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. So no keel code runs unbundled. The migrator is bundled by
  esbuild inside CDK. The job runner is not written yet (cutover row `job-runner`) and must be bundled with
  esbuild or run under tsx.
- **Source puts keel under the consumer's compiler options.** 145 of keel's files were in the consumer's `tsc`
  program. Turning on `--noUncheckedIndexedAccess` produced 23 errors inside keel's source, and
  `--exactOptionalPropertyTypes` produced 19. `skipLibCheck` does not cover `.ts` files, so the adopter cannot
  silence them. The consumer also needs the `@types` keel's source uses: its typecheck failed until it added
  `@types/pg`, a devDependency of keel's workspace root that the package never declared.
- **Compiled is feasible under C.** `tsc --emitDeclarationOnly`, with the seam pointed at keel's fixture,
  emitted 168 declaration files. 22 of them keep the seam imports as written, so each consumer's composed
  unions are computed against its own registrations, and no fixture vocabulary appears in any declared type.
  That run had 74 errors from dependencies missing from the borrowed `node_modules`. It shows the shape, not a
  finished build.
- **The tarball ships too much.** With no `files` field, `pnpm pack` produced 274 files (412 KB), including 57
  test and story files and 43 files of the test fixture.

**Answer: 0.x ships TypeScript source**, which is what both apps compile against today, and adds:

- a `files` allowlist;
- the `@types` keel's source needs, as dependencies;
- a tsconfig base in `@<scope>/keel-tools` that the app extends, so that the options keel compiles under are
  the ones it is tested with;
- `transpilePackages` set by the Next preset.

**Move to compiled JS with declarations** (built against the fixture seam, with a check that no fixture name
leaks into a type) when an adopter needs stricter compiler options than keel's, when keel code has to run under
plain Node, or when type-checking keel's source in every app costs enough to notice. Under C that move does not
touch the seam.

### 3. The gates that walk the app

Each gate becomes part of a **conformance kit** (helpers at `keel/testing`, or a `keel` CLI command the app's
verify calls), stays **keel-repo-only**, or is **dropped**. keel's seam-conformance suites already run from
`node_modules` against a consumer's seam: 4 of the 5 files passed (13 tests) unmodified. The fifth,
`demo-presets-seam.test.ts`, failed only on its import of `../../../../tests/support/tmp-dir`, a path outside
the package. 23 of keel's 57 test files import from the repo's `tests/` that way, so the kit's first job is to
own its helpers.

| Gate                                                                                                                                                                                                               | Becomes                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| typecheck of ALL of keel against each app (the starter's `tsconfig.json` includes `packages/keel/src`)                                                                                                             | keel-repo-only: the two-consumer rule. A consumer typechecks the keel it reaches                                            |
| authorized-mutations scan (`packages/keel/src/authz/authorized-mutations.test.ts`)                                                                                                                                 | kit: a scan of the app's own `src/app`; keel keeps the fixture root and the exemption staleness check                       |
| i18n partition and parity (`packages/keel/src/i18n/*.test.ts`)                                                                                                                                                     | kit                                                                                                                         |
| the composed pglite RLS suite (`packages/keel/src/db/rls-pglite.test.ts`)                                                                                                                                          | kit                                                                                                                         |
| migration numbering and upgrade order (`packages/keel/src/db/migrate.test.ts`)                                                                                                                                     | kit                                                                                                                         |
| demo-presets conformance (`packages/keel/src/server-lib/demo-presets-seam.test.ts`)                                                                                                                                | kit, once its temp-dir helper moves into the package                                                                        |
| RLS contract on real Postgres (`vitest.contract.config.ts`, `apps/*/tests/contract`)                                                                                                                               | the app keeps its contract test and calls the kit's runner; keel keeps the fixture's; the reusable workflow brings Postgres |
| the singleton check (part 5)                                                                                                                                                                                       | kit and CLI (`keel doctor`)                                                                                                 |
| demo size (`scripts/check-demo-size.mjs`, `tests/tooling/check-demo-size.test.ts`)                                                                                                                                 | CLI: `keel check-demo-size <bytes>`; the budget stays in the app's `package.json`                                           |
| Mantine CSS pruning (`scripts/vite-prune-mantine-css.ts` and its test)                                                                                                                                             | `@<scope>/keel-tools`, inside the Vite preset                                                                               |
| static-demo bundle shape (`tests/tooling/static-demo-bundle.test.ts`)                                                                                                                                              | keel-repo-only: it pins how keel's modules are written                                                                      |
| scratch-dir hygiene (`tests/support/tmp-dir.ts`, `scripts/check-tmpdir-leak.mjs`, `keel/no-direct-mkdtemp`)                                                                                                        | kit (the helper), CLI (the leak wrapper), preset (the rule)                                                                 |
| ports, `.claude/launch.json`, `dev:real` preflight, standalone serve, e2e profile (`scripts/ports.mjs`, `print-port.mjs`, `write-launch-json.mjs`, `check-real-env.ts`, `serve-standalone.mjs`, `e2e-profile.mjs`) | CLI                                                                                                                         |
| lint gates (`tests/lint/*.test.ts`)                                                                                                                                                                                | move with the ESLint plugin, as its own tests                                                                               |
| doc paths (`tests/docs/doc-paths.test.ts`, `doc-set.test.ts`)                                                                                                                                                      | keel-repo-only for keel's docs. The checker is generic; offering it as a CLI command is deferred                            |
| adopter identity (`tests/docs/adopter-identity.test.ts`)                                                                                                                                                           | dropped: `create-keel-app` writes the owner files from its flags once, and no later merge can bring keel's back             |
| issue forms (`tests/docs/issue-forms.test.ts`)                                                                                                                                                                     | keel-repo-only                                                                                                              |
| adoption probe (the `adoption-probe` CI job)                                                                                                                                                                       | replaced by pack and consume (part 7)                                                                                       |
| knip, jscpd, gitleaks, commitlint, lint-staged, Prettier                                                                                                                                                           | config files `create-keel-app` writes once; they are the app's from then on                                                 |

### 4. The lint fences

**Split.** Of `eslint.config.mjs`'s 34 blocks, 23 carry a fence: 6 cover only app code, 7 only keel's tree, and
10 both, `keel/public-surface` among them, since it applies to every file.

- **Keel-internal, staying in this repo:** the framework/app fence over `packages/keel` (the app-content
  patterns, `keel/no-dynamic-app-import`, `keel/no-path-to-app-code`), keel/core's framework ban and
  `keel/no-jsx-in-core`, keel's adapter blocks, the fixture's bans, and `keel/public-surface`.
- **App-side, becoming the preset:** vendor SDKs only in `src/adapters/real/` (the static ban and
  `keel/no-dynamic-vendor-import`), the app-adapter rules (registry, fakes, `real/`), the `process.env` and
  run-mode bans, `keel/no-raw-db-handle` with the app's own exceptions, `react/jsx-no-literals` and the
  a11y-literal ban, the `next/font/google` ban, `keel/no-direct-mkdtemp`, and the base TypeScript, React and
  Next config with its carve-outs for tests, stories and migrations.

**The preset works from outside the app.** The spike put a stand-in preset in a directory beside the consumer,
as a package in `node_modules` would be, with app-relative globs (`src/**`, ignoring `src/adapters/real/**`).
Flat config resolves `files` against the consumer's own config directory, so a probe importing `pg` and reading
`process.env` was reported twice in `src/domain/` and not at all in `src/adapters/real/`. Linting the whole app
also showed that a preset of fences alone is not enough: the base config has to come with it (`no-undef` off
for TypeScript, the migrations carve-out, the test carve-out).

**One implementation, two consumers.** The preset is a factory, `configs.app({ root })`. A consumer calls it
with the default `.` and keel's root config calls it with `apps/*`, so the same rules are proved against both
apps before an adopter sees them. The rule ids stay `keel/…`, because flat config namespaces a plugin by the key
a config gives it, not by the package name, so existing disable comments keep working. #51's app-owned
exceptions stay where #51 put them, `lint-exceptions.mjs` at the app's root (`apps/<app>/` here, the repository
root in a single-app consumer), and the preset reads them instead of `eslint.config.mjs`.

**`keel/public-surface` is redundant for a consumer.** In the spike, TypeScript's `bundler` resolution refused
both an unpublished subpath (`keel/db/migrations/index`) and a deep path (`keel/src/adapters/fake/pglite-dialect`)
with TS2307, because a real `node_modules/keel` has an `exports` map. The rule stays in this repo, where tsconfig
`paths` and the Vite and Vitest aliases send `keel/*` straight to source and bypass the map (ADR-0012's lesson).

### 5. Singleton peers

keel already declares `react`, `next`, `next-intl` and `@mantine/core` as `peerDependencies` (ADR-0012, "The
dependency manifest"). It imports no `react-dom` and no `@mantine/hooks`. It does import `kysely` in 31 source
files, and an app's migrations receive keel's `Kysely` instance, so `kysely` moves to the peers as well.

**What happens on a mismatch.**

- With the app on `react` 19.3.1 and keel's peer at `~19.2.8`, pnpm linked keel to the app's copy (one copy),
  printed a peer warning, and `pnpm peers check` listed it.
- With `react` moved from keel's peers to its plain `dependencies` (the mistake ADR-0012 warns about), install
  succeeded with no warning, and keel got its own `react` 19.2.9.
- Inside this workspace, the dependency group that #36 superseded raised the apps' floors but not keel's peer
  floors. That kept old `next-intl` and `@mantine/core` copies in keel's part of the lockfile, so
  `useTranslations` found no provider while `lint-typecheck-unit` stayed green (build-notes, 2026-11-16).

**The check.** For each singleton, compare the real path of its entry point resolved from keel's directory with
the one resolved from the app's. This is the `readlink -f` check build-notes tells a dependency PR to run by hand,
made a command. In the spike it reported one copy of each of `react`, `react-dom`, `next`, `next-intl` and
`@mantine/core`. Against the `dependencies` mistake it printed `TWO COPIES  react` and exited 1. It ships as
`keel doctor`, which the app's verify runs, and in the kit.

### 6. Migrations, catalogs, screens, the static demo, CSS pruning and demo size

- **Framework migrations** stay inside keel (0001–0999), composed with the app's (1001 and up) through the seam,
  as now. From the tarball, 12 framework migrations plus the app's `1001_items` ran on pglite, and the seeder
  filled two tenants. A release that adds a framework migration says so in its changelog. The kit's
  migration-order check proves that the new migration sorts safely against the app's own.
- **Catalogs.** keel's `en`/`es` JSON is already an exported subpath (`keel/i18n/messages/en.json`) and is still
  deep-merged at every load site. next-intl's plugin wants a file path for its request config. Today the apps
  pass `../../packages/keel/src/i18n/request.ts`; the spike passed `./node_modules/keel/src/i18n/request.ts`,
  which works but names keel's internal layout. The Next preset resolves the published subpath
  (`keel/i18n/request`) instead.
- **Screens and the demo shell** are TSX source, compiled by Next and by Vite. The spike's static demo came to
  727,658 bytes, against 727,553 for the same starter built inside this repo.
- **Mantine CSS pruning** lives in the repo's `scripts/`, so the spike had to copy it. It moves into the Vite
  preset in `@<scope>/keel-tools`.
- **Demo size** becomes `keel check-demo-size <bytes>`, and the number stays in the app's `package.json`, as now.

### 7. CI

**A reusable workflow (`on: workflow_call`) in this repo, referenced by tag**, carrying the jobs keel defines
today: lint, typecheck and unit (with the kit and `keel doctor`), contract (with a `postgres:16` service, as
now), e2e shards discovered from the app's Playwright config, the static demo, and the secret scan. The app's
own workflow calls it and adds whatever is the app's. A workflow in a public repository can be called from
other repositories when the caller's organization allows public reusable workflows; Pages' organization must
allow it.

**Pack and consume replaces the adoption probe.** It packs every package, generates an app with
`create-keel-app` in a directory outside the workspace with the tarballs as its dependencies, installs, and runs
that app's verify: typecheck, lint, unit tests plus the kit, `keel doctor`, `next build` with `E2E_BUILD=1`, the
static demo and its size, and the migrator's esbuild bundle with an assertion that it holds the app's own
migrations. Each of those steps ran in the spike. What the spike found is the reason for the job: keel's tests
reaching into the repo's `tests/`, `@types/pg` declared only at the workspace root, and transitive build-script
approvals that only keel's `pnpm-workspace.yaml` granted (pnpm 11 failed the consumer's install with
`ERR_PNPM_IGNORED_BUILDS` for `@swc/core`). None of these can show inside the workspace.

### 8. Infra

A **`KeelApp` construct**, not a `Stack` subclass, so that an adopter composes it with their own (Pages already
has its own edge construct in its `infra/lib`). Its props: the app's directory and slug, the database transport
(`pg` or `data-api`, #49's two network shapes), and the deployment params. The migrator's entry is resolved from
the package (`keel/adapters/real/migrate-handler`) and bundled by esbuild, which under C needs no alias. At synth,
the construct asserts that the migrator bundle holds the app's own migrations, the check that would have caught
today's `infra/stack.ts` bug. #49's `infra/check-shapes.ts`, which synthesizes both network shapes, becomes the
package's own test.

### 9. Agent assets

- **A Claude Code plugin**, from a marketplace in this repo, carrying the 18 commands in `.claude/commands` and
  the `doc-steward` agent. Commands that cite `apps/<app>/src/…` are rewritten app-relative (`src/…`). The plugin
  is pinned to the same tag as the packages, because a plugin installs from its marketplace, not from the app's
  lockfile.
- **`CLAUDE.md` splits in two.** The rules an app author follows (the seam, vendor SDKs, `getDb`, i18n,
  router-agnostic screens, hermetic dev) ship as a markdown file inside `@<scope>/keel`, and the adopter's own
  `CLAUDE.md` imports it with Claude Code's `@path` import from `node_modules`. The guide an agent reads is then
  the version the app installed. The maintainer half (two apps, the fixture, the fence internals, the merge
  rules) stays in this repo's `CLAUDE.md`. The `node_modules` import is to be verified in step P9.

### 10. Releases

- **Changesets, with every package in one fixed group:** one version number for the set, and a generated
  changelog.
- **0.x semantics as npm reads them.** `^0.3.0` accepts only `0.3.x`, so a **minor** is the breaking channel and a
  patch must be compatible. Breaking means: a seam change (a new required export in an `app-config` module, the
  kind `docs/adopting.md`'s "When an update changes what your seam must say" lists), an `exports` removal, a
  framework migration that needs operator action, a raised peer floor, or a preset rule that turns existing app
  code red.
- **Every changelog entry has a "Seam changes" section and a "Framework migrations" section**, empty or not.
  They replace the merge-time discovery ADR-0013 relied on.
- **Cadence: on demand, at most weekly while 0.x.**
- **The two-consumer rule gates every release:** both apps green and pack and consume green on the release
  commit.
- **Before the registry is chosen** (D1), releases can ship as tarballs attached to a GitHub release of this
  public repo, installable by URL.

### 11. Pages' migration from fork to dependency

The measurement in the Context is the reason this can be early and cheap: Pages has never edited
`packages/keel`.

1. **Catch up first.** Take the last upstream merge, so that Pages starts from the release the package is cut from.
2. **Delete what is keel's.** That is `packages/keel`, and the scaffold files that are untouched copies of keel:
   107 of the 176 measured (85 identical plus 22 older keel versions). Delete those without reading them.
3. **Add the dependencies:** `@<scope>/keel` (aliased `keel`), `@<scope>/eslint-plugin-keel`,
   `@<scope>/keel-tools`, and `@<scope>/keel-cdk` if Pages takes keel's infra. Add the seam link
   (`"@<scope>/app-config": "link:./src/app-config"` in `apps/console/package.json`) and the seam `package.json`.
4. **Replace the config with presets:** `eslint.config.mjs` becomes the app preset plus Pages' own blocks, with
   its `getDb` exceptions in `lint-exceptions.mjs`; `tsconfig.json` extends the base; `next.config.ts`,
   `vite.demo.config.ts` and `vitest.config.ts` use the presets; `checks.yml` calls the reusable workflow and
   keeps Pages' own jobs; keel's `scripts/` go, replaced by the CLI.
5. **Read the 65 locally edited files one by one.** Each is either an `init-app` rewrite of a keel file (delete
   it, because the package now carries keel's version) or a real Pages decision (keep it, or move it into the
   preset options).
6. **Docs.** keel's ADRs, recipes, runbooks and doctrine stay in keel and are linked by version. Pages keeps its
   own `CLAUDE.md`, which imports keel's app guide, its own cutover checklist, and its own records, cut off at
   the fork date.
7. **Keep what is Pages':** `apps/console`, Pages' `packages/cli` and `packages/gate`, its edge infra, and its
   own future tasks.
8. **Then:** `pnpm install`, `pnpm verify` and the contract tests.

**A script?** Not a shipped one: there is one adopter. The inventory that produced the counts above (classify
each scaffold file as identical, an older keel version, or a local edit, by whether its blob is in keel's
history) is worth running once in Pages to drive steps 2 and 5, and is twenty lines.

### 12. Open decisions for JP

These are listed with recommendations under "Open decisions for JP" below.

## Alternatives considered

1. **Stay on fork and merge, and keep fixing friction.** Each fix this week was real and cheap (#31, #39, #51),
   and more are available: a `merge=union` attribute for the two record files, moving every per-app value out of
   shared config, a manifest of keel-owned files. What they cannot fix: the 65 diverged scaffold files are an
   adopter's legitimate edits to files keel also owns (CI, lint, docs), and any keel change to one of them
   conflicts, whatever else is fixed. A fork also has no version to pin or roll back, and no way to take one fix
   without taking the whole merge. And every friction fix is itself a change to scaffold files that conflicts on
   its way in.
2. **Publish only `packages/keel`, and keep the scaffold by fork.** It fixes the half that already merges cleanly
   (0 local edits in Pages) and leaves the 65-file half.
3. **A git subtree or submodule for `packages/keel`.** The same result as 2, with tooling adopters tend to resent.
4. **A template updater for the scaffold** (three-way diffs of the template, as cruft and copier do). It is still
   one merge per file the adopter edited. `create-keel-app` writes the few files that must stay app-owned config
   (knip, Prettier) once, and they rarely change.
5. **Option A or option B for the seam**, and **compiled from day one** (parts 1 and 2).

## Consequences

- An adopter's repository is their app plus thin config. An upgrade is `pnpm up` and reading the changelog's
  "Seam changes". There are no merges, and a fix arrives without the rest of upstream.
- keel pays ADR-0013's predicted cost (semver judgement, a changelog, deprecation windows), now that there is a
  consumer to pay it for.
- keel can no longer quietly depend on its own workspace: tests importing the repo's `tests/`, `@types` declared
  at the root, a root tsconfig deciding the seam. Pack and consume makes each of those red.
- ADR-0012's seam keeps its shape, and its specifier is renamed (an addendum, if this is accepted).
- An adopter cannot edit keel in place. ADR-0013 already said a keel change must never be carried locally, and
  `pnpm patch` is the emergency valve while the fix goes upstream.
- Retired after Pages switches: `init-app`, the adoption probe, the adopter-identity test, and the fork sections
  of `docs/adopting.md` (rewritten around `create-keel-app`). The doc gate's rule for reference-app citations
  in merged-in docs then serves only this repo.

## Open decisions for JP

- **D1 — Registry. Recommend public npm.** keel's repo is public and MIT. GitHub Packages' npm registry requires
  an access token to install even a public package, so every adopter's machine and CI would need one. Choose
  GitHub Packages only if keel should stay private during 0.x. Either way, D5 lets Pages switch before this is
  decided.
- **D2 — Scope and names. Recommend an npm organization scope that keel owns, chosen before step P1.** Checked
  read-only on 2026-11-17: `keel` is taken (teamkeel's backend framework, version 0.505.0, published that day),
  and so are `create-keel-app` and `keeljs`. The seam's name must be scoped (part 1), and the rename in P1 writes
  the scope into every seam import, so it comes first. `@keel/core` and `@keel/eslint-plugin` return 404, but
  whether an organization owns `@keel` cannot be checked anonymously. Consumers keep writing `keel/…` through a
  package alias (`"keel": "npm:@<scope>/keel@^0.1"`), so no app import changes; P1 verifies that the alias
  behaves with peers and the CLI.
- **D3 — Licence and copyright line. Recommend deciding before 0.1.0, with counsel.** Today it is MIT,
  "Copyright (c) 2026 JP Slavinsky". Publishing puts that line into every installed copy.
- **D4 — Does this repo keep the showcase? Recommend yes**, as the reference app, the public demo and the first
  of the two consumers. It is never published. `create-keel-app` has no eject: its template is `apps/starter`,
  copied when the generator is packed, so the template is always the app the two-consumer rule tests.
- **D5 — When Pages switches. Recommend as soon as pack and consume is green (P8)**, on GitHub-release
  tarballs, without waiting for D1.

## Implementation plan

Each step is one PR and leaves both apps green, because each moves the in-repo apps onto the new piece in the
same PR. Decisions first: **D2 blocks P1** and **D1, D2 and D3 block P10**.

| Step | PR                                                                                                                                                                                                                                                                                                                                               | Depends on     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| P1   | **Rename the seam to `@<scope>/app-config/*`.** A codemod over keel's source, tests and fixture, both apps' tsconfig, Vitest and Vite aliases, the root tsconfig, both Vitest configs, the lint fence and its tests, and the docs; then grep for the old token. Add the seam `package.json` and the optional peer. Verify the npm alias from D2. | D2             |
| P2   | **Package hygiene.** A `files` allowlist; the `@types` keel's source uses, as dependencies; `kysely` as a peer; the helpers 23 of keel's tests import from the repo's `tests/support`, moved into keel. `private` stays until P10.                                                                                                               | —              |
| P3   | **The conformance kit at `keel/testing`:** the mutation scan (per app root), i18n partition and parity, the pglite RLS runner, migration order, demo presets, singletons. Each app runs it from its own test file, as a consumer will, instead of `vitest.config.ts` including keel's test files.                                                | P2             |
| P4   | **`@<scope>/eslint-plugin-keel`:** the rules, and `configs.app({ root })`. The root config uses it for `apps/*` and keeps keel's internal blocks; `tests/lint` moves with it; the exceptions file moves to the app root.                                                                                                                         | P1             |
| P5   | **`@<scope>/keel-tools`:** the `keel` CLI (demo size, ports, launch config, `dev:real` preflight, standalone serve, e2e profile, `doctor`, the temp-dir leak wrapper), the Next, Vite and Vitest presets, and the tsconfig base. Both apps switch, and `scripts/` keeps only what is keel's own.                                                 | P2             |
| P6   | **`@<scope>/keel-cdk`:** the `KeelApp` construct (both transports, `check-shapes`), with the migrator resolved from the package and the synth-time migrations assertion. `infra/` becomes an instantiation for the showcase.                                                                                                                     | P1             |
| P7   | **`@<scope>/create-keel-app`:** the starter template plus generated config (presets, seam link, `allowBuilds`, a workflow calling the reusable one, a `CLAUDE.md` importing the app guide, owner files from flags).                                                                                                                              | P3, P4, P5, P6 |
| P8   | **CI: the reusable workflow, and the pack-and-consume job.** The adoption probe stays until P12.                                                                                                                                                                                                                                                 | P7             |
| P9   | **The Claude Code plugin, and the `CLAUDE.md` split**, with the `@node_modules/…` import verified.                                                                                                                                                                                                                                               | P7             |
| P10  | **Releases:** Changesets in a fixed group, the release workflow, changelog sections, then 0.1.0 on the chosen registry. JP adds the registry token as a repository secret.                                                                                                                                                                       | P8, D1–D3      |
| P11  | **Pages switches** (in `safeinsights/pages`, part 11), on tarballs from P8 or on 0.1.0.                                                                                                                                                                                                                                                          | P8 (D5)        |
| P12  | **Retire the fork machinery:** `init-app`, the adoption probe, the adopter-identity test, and the fork sections of `docs/adopting.md`. ADR-0013 becomes Superseded.                                                                                                                                                                              | P11            |

P2, P3 and P5 can start before D2 is decided. P4, P5 and P6 touch different files and can run in parallel, and
P9 can run beside P8. The critical path runs through D2: D2, P1, P4 (or P6), P7, P8, then P11.
