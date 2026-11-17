# ADR-0014 — keel ships as versioned packages: the framework, its fences and its scaffold

- Status: Proposed
- Approver: JP Slavinsky
- Date: 2026-11-17
- Supersedes, if accepted: [ADR-0013](0013-upstream-updates-fork-and-merge.md)

## Context

[ADR-0013](0013-upstream-updates-fork-and-merge.md) chose to keep keel publishable-shaped and to distribute it
by fork and merge, and it named four triggers that would reopen the question. The first has fired: **a second
real app outside this repo.** The SafeInsights sharing site (`safeinsights/pages`, app slug `console`, deploying to AWS Lambda with Aurora, reaching it through the RDS Data API once keel's transport for it (#46, #49) arrives) adopted keel by fork this week.

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
  keel versions and 4 are Pages' own. **65 differ from every version keel has ever had.** Each is a file where
  any later keel change conflicts.
- **Of those 65, 47 are mechanical and 18 are Pages' own.** The newest keel commit in the history of Pages' `main` is 24b0589 (#32). `pnpm init-app console --repo pages --eject-showcase`, run on that commit, writes 47 of the 65 byte for byte. The other 18 are Pages' deliberate edits to files keel also owns: its own `README.md` and the head of its `CLAUDE.md`; `eslint.config.mjs`, `knip.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` and `.prettierignore` extended for `packages/gate`, `packages/cli` and `infra`; its `pages` script in `package.json`; its CI workflow; its `.gitleaks.toml` entry; its owner details; its own migration's name in `docs/adopting.md`; and a `LICENSE` that adds Rice University's copyright above keel's.

So the framework already travels like a package. The scaffold is what a fork cannot carry. ADR-0013's other
point stands, and it is the constraint any answer has to meet: keel is also scaffolding (the verify gate, the
lint fences, CI, infra, the `apps/` layout, the doc doctrine, the agent commands), and `pnpm add` does not
deliver scaffolding. Publishing only `packages/keel` would fix the half that already works and leave the
65-file half where it is.

The first adopter is also not a single app. Pages is a workspace holding `apps/console`, its own
`packages/gate` (a CloudFront Function, its stand-in runtime and tests) and `packages/cli` (bundled with
esbuild), and an `infra/` with its own `PagesEdge` construct, an edge stack, conformance scripts and separate
CDK apps. On its `integration` branch, where its work lands before `main`, its console has its own `src/adapters/real/` (S3 and the CloudFront key-value store). Its CI runs on pushes to `main` and `integration`, with its own `.gitleaks.toml`. Whatever keel ships has to sit beside all of
that, not replace it.

## Decision

**keel is distributed as versioned 0.x packages, and the scaffold becomes packages too, so that an adopter's
repository holds their app, their own packages, and a thin layer of config that imports keel's.** This
repository stays the monorepo where the packages are built. `apps/showcase` and `apps/starter` stay as the two
consumers that every release must compile and pass against.

| In a fork today                                                | Becomes                                                   | Delivered as                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/keel`                                                | the framework, plus a conformance kit at `keel/testing`   | `@<scope>/keel`, still imported as `keel/…` (open decision D2)        |
| the fences in `eslint.config.mjs`                              | an ESLint plugin with an app preset                       | `@<scope>/eslint-plugin-keel`                                         |
| root `tsconfig.json`, the Next/Vite/Vitest configs, `scripts/` | a tsconfig base, config presets and a `keel` CLI          | `@<scope>/keel-tools`                                                 |
| `infra/`                                                       | a CDK construct an adopter composes                       | `@<scope>/keel-cdk`                                                   |
| `pnpm init-app <slug> --eject-showcase`                        | a generator whose template is `apps/starter`              | `@<scope>/create-keel-app` (`pnpm create @<scope>/keel-app`)          |
| `.claude/commands`, `.claude/agents`, `CLAUDE.md`'s rules      | a Claude Code plugin, and an app guide inside the package | a plugin marketplace in this repo; a markdown file in `@<scope>/keel` |
| `.github/workflows/checks.yml`                                 | a reusable workflow the app's own workflow calls          | `jpslav/keel/.github/workflows/…`, pinned by commit SHA               |

The rules that come with it, each argued in the hard parts below:

1. **The seam becomes a package the app provides** (part 1, option C). Its specifier is renamed from
   `@app-config/*` to `@<scope>/app-config/*`. Nothing else about ADR-0012's seam changes.
2. **`@<scope>/keel` ships TypeScript source for 0.x, and every other package ships JavaScript** (part 2).
   keel's source is only ever compiled by `tsc` or a bundler. Whatever Node loads directly is JavaScript, keel's
   one compiled entry point (`keel/testing/e2e`) included.
3. **pnpm 11 or later is a requirement for adopters.** Option C rests on pnpm's `link:` protocol and its peer
   linking, and `allowBuilds` is pnpm's.
4. **Only `@<scope>/keel` is imported at run time, and the other keel packages do not depend on it.** The ESLint
   plugin, `keel-tools`, `keel-cdk` and `create-keel-app` reach keel, where they need it at all, from the app's
   own directory. All of them are versioned in lockstep, and `keel doctor` checks that the installed versions
   match (parts 5 and 10). One keel instance per app; one version number for the set.
5. **Pack and consume is the first thing built, and a required check on every PR from then on** (part 7). It
   packs the packages and installs the tarballs into an adopter-shaped workspace outside this repo, and that
   workspace's verify must pass. Inside this repo, workspace links hide exactly the failures it catches.
6. **Everything keel ships is composed by the adopter, never adopted wholesale**: an ESLint preset beside their
   own rules, a CDK construct beside their own stacks, a reusable workflow called from their own workflow
   beside their own triggers and jobs.
7. **Pages switches from fork to dependency once, early, on release-candidate tarballs** (part 11), before any
   registry exists. New adopters start from `create-keel-app`. Fork and merge ends when Pages has switched.

Everything ADR-0013 required of a publishable shape stays required, because it is now the package's contract:
the explicit `exports` map, private-by-default modules, zero host escapes, two consumers.

## The hard parts

Each answer below was settled with a spike. Throwaway consumers were built **outside** the workspace as copies
of `apps/starter`, and keel was installed into them as a **packed tarball** (`pnpm pack` in `packages/keel`),
never through `workspace:`. The last of them is laid out like Pages: a workspace with `apps/console`, an
app-owned `src/adapters/real/` adapter, and a sibling package that does not use keel. None of it is committed.
Every number here comes from the spike unless it says otherwise. The spike packed keel at 3d9b96a, before #46,
#49, #51 and #52 merged; counts of this repository's own files are taken at 6d67a7c, after them.

### 1. The seam

**The question.** keel's source imports the app's registrations as bare `@app-config/*` specifiers: 32 source
files import 18 seam modules, and 27 of those files import values, not only types. Whatever builds keel has to
resolve those to the app's `src/app-config`. Inside this repo, aliases do it: tsconfig `paths` in each app, an
alias per app project in `vitest.config.ts`, and an alias in each demo's vite config.

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
under A, every tool that builds keel needs its own alias, the presets have to know every one of them, and the
first runner nobody wrapped fails. An alias can also point at the wrong seam without failing at all. That
happened on `main` this week: `infra/stack.ts` bundled the migrator with the root `tsconfig.json`, whose `paths`
send `@app-config/*` to keel's test fixture. Bundled the same way, the migrator carried the fixture's three
`dockets` migrations and none of the showcase's. #54 fixed it, and Pages' copy of the stack still has it.

**Option B: a runtime registry, with module augmentation for the types, shipping compiled JS.** Sketched
against three real seam modules (`jobs`, `identity` and `abilities`):

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
`1001_items`), and tsx. The same held in the Pages-shaped workspace, with the app at `apps/console`: the peer
linked to `apps/console/src/app-config`. It keeps ADR-0012's seam as decided: plain modules, imported directly,
checked by the compiler, one module per capability. In that workspace, a second app linking its own seam got a second keel instance in the virtual store, each linked to its own app's `src/app-config`.

What C costs:

- **The rename.** `@app-config/db/migrations` parses as a package named `@app-config/db`, so the seam has to
  become ONE package with subpaths: `@<scope>/app-config/*`. It is a codemod across keel's source, tests and
  fixture, both apps' aliases, the lint fence and the docs.
- **A `package.json` in each app's `src/app-config`, and a `link:` dependency.** `create-keel-app` writes both.
  Its `exports` map has to cover every seam module keel imports. The `./*` pattern covers flat `.ts` modules
  only, so a `.tsx` module or a directory module needs its own entry, as `db/migrations` does. The kit checks
  that every seam specifier keel imports resolves through the app's map.
- **The name must sit in a scope keel owns.** In the option-C consumer, `pnpm add` requested `keel-app` from the
  npm registry (404). An unscoped seam name that somebody else later published could install a stranger's
  package where the app's registrations belong. The peer is also marked optional in `peerDependenciesMeta`:
  pnpm's `autoInstallPeers` installs only missing non-optional peers, so it never fetches the seam on its own.
  `keel doctor` (part 5) then fails if the seam is not linked, since an optional peer no longer warns.
- **pnpm only.** npm rejects the `link:` protocol, and under npm the seam would resolve only by hoisting.
  Hence rule 3.
- **Inside this repo, resolution still goes through aliases.** A bare specifier resolved from `packages/keel`
  can name only one app, which is ADR-0012's reason for one Vitest project per app. So the per-app aliases
  stay, with the new key, and decide it here exactly as now. Anything that builds keel without them in this
  repo falls back to the root tsconfig's mapping, which is the test fixture: that is the `infra/stack.ts` bug
  above. Builders keel owns therefore always pass the seam explicitly (part 8), and pack and consume (part 7) is
  the only test of the link path, which is why it runs on every PR.

**Answer: C for 0.x.** It is the only option under which no tool outside this repo needs to be told where the
seam is. What would move us to B: keel needing more than one app in one process or one build, an adopter who
cannot use pnpm, or registrations that must arrive at run time (per-tenant plugins). None of these exists. If
accepted, ADR-0012 gets an addendum recording the new specifier.

### 2. Source versus compiled

**What the spike showed.**

- **The web Lambda does not care.** `next build` with `output: 'standalone'` bundled keel completely: no keel
  file and no `.ts` file is in `.next/standalone`, and `pg` and pglite are traced as externals.
- **Every bundler keel goes through can compile it from `node_modules`**: `tsc`, Turbopack, Vite, Vitest,
  esbuild and tsx (the table in part 1, under C). **Plain Node cannot**: Node 24.19 refuses with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
- **Some of today's scaffold hands keel to plain Node**, and would break the same way:
    - Playwright does not transform files under `node_modules` (`shouldTransform` in `playwright/lib/common/index.js` returns false for them), and
      `apps/showcase/tests/e2e/destructive/simulator-webhooks.spec.ts` imports `keel/core/webhook-signing`.
    - A Vite or Vitest config file is bundled with its bare imports left external, so a preset it imports is
      loaded by Node. The prune plugin that would move into the Vite preset is TypeScript today
      (`scripts/vite-prune-mantine-css.ts`). The spike never hit this, because it copied the plugin into the
      consumer.
    - The `dev:real` preflight, `scripts/check-real-env.ts`, imports `keel/adapters/real/index`; as a CLI bin it
      would run under Node.
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

**Answer: `@<scope>/keel` ships TypeScript source for 0.x, consumed only through `tsc` and bundlers.** That is
what both apps compile against today. It comes with:

- a `files` allowlist;
- **keel compiling under a named set of strict options**, so that an adopter who turns any of them on cannot
  break keel: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and `erasableSyntaxOnly`, which give 26, 24, 58 and 8 errors in keel's non-test source at 6d67a7c. `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch` give none. Code that passes
  a flag still compiles with it off. Pack and consume typechecks its consumer with the whole set on, so the set
  is a tested promise, not a hope;
- the `@types` keel's source needs: those of host singletons (`@types/react`) and `typescript` as peers, with
  keel's tested ranges, and the rest (`@types/pg`) as dependencies. Two `@types/react` trees would split
  keel's JSX and the app's the way two copies of React split context, and no runtime check sees it;
- a tsconfig base in `@<scope>/keel-tools` that the app extends;
- `transpilePackages` set by the Next preset.

**Every other package ships JavaScript**: the ESLint plugin, `keel-tools`, `keel-cdk` and `create-keel-app`,
since Node loads them directly. They may be written in TypeScript and built when packed. **What reaches keel
from a Node-loaded context goes through a bundler or a compiled entry point.** The CLI runs keel code through
esbuild. Playwright loads e2e specs with Node, so an e2e spec may reach keel only through `keel/testing/e2e`,
which the kit ships compiled. That entry point is seam-free: keel's `webhook-signing` reads `APP_SLUG` from the
seam when it loads, so the signature check is split from the header constants, and packing fails if the
compiled entry imports the seam. A lint ban on direct imports is not enough, because a spec reaches keel
indirectly too: the showcase's `tickets-pagination.spec.ts` imports the app's `src/domain/tickets`, which
imports `keel/core/state-machine`. So `keel check-e2e` bundles each spec with esbuild and fails if any keel file
other than `keel/testing/e2e` is reached.

**Keel code is always bundled or compiled.** Even a compiled keel under plain Node would load the app's seam
with Node's resolver, which needs file extensions the seam does not write (`./1001_items`) and ignores tsconfig
`paths` the seam does use (`@/jobs/…`). So compiled output for the framework is a later step, and its trigger is
build cost (type-checking keel's source in every app), not compiler options. Under C that step does not touch
the seam.

### 3. The gates that walk the app

Each gate becomes part of a **conformance kit** (helpers at `keel/testing`, or a `keel` CLI command the app's
verify calls), stays **keel-repo-only**, or is **dropped**. keel's seam-conformance suites already run from
`node_modules` against a consumer's seam: 4 of the 5 files passed (13 tests) unmodified. The fifth,
`demo-presets-seam.test.ts`, failed only on its import of `../../../../tests/support/tmp-dir`, a path outside
the package. 23 of keel's 57 test files import from the repo's `tests/` that way, so the kit's first job is to
own its helpers. Every kit check and CLI command runs per package, from the app's own directory, so an adopter's
workspace can hold packages that are not apps (Pages' `gate` and `cli`). Helpers that do not touch the seam live
in `keel-tools`, not the kit, so such a package uses them without taking keel: Pages' `cli` tests import
`makeTestTmpDir`, and its `infra` would run the template checks.

| Gate                                                                                                                                                                                                               | Becomes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck of ALL of keel against each app (the starter's `tsconfig.json` includes `packages/keel/src`)                                                                                                             | keel-repo-only: the two-consumer rule. A consumer typechecks the keel it reaches                                                                                                                                                                                                                                                                                                                                                 |
| authorized-mutations scan (`packages/keel/src/authz/authorized-mutations.test.ts`)                                                                                                                                 | kit: a scan of the app's own `src/app`, honouring app-owned exemptions (each with its required `mustMatch`, read from the app the way #51's `lint-exceptions.mjs` is), since an adopter can no longer edit keel's map. An app-owned exemption that matches no file in the app's tree fails, so a deleted route's exemption cannot wait for a new route at the same path. keel keeps the fixture root and its own staleness check |
| i18n partition and parity (`packages/keel/src/i18n/*.test.ts`)                                                                                                                                                     | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| the composed pglite RLS suite (`packages/keel/src/db/rls-pglite.test.ts`)                                                                                                                                          | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| migration numbering and upgrade order (`packages/keel/src/db/migrate.test.ts`)                                                                                                                                     | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| demo-presets conformance (`packages/keel/src/server-lib/demo-presets-seam.test.ts`)                                                                                                                                | kit, once its temp-dir helper moves into the package                                                                                                                                                                                                                                                                                                                                                                             |
| RLS contract on real Postgres (`vitest.contract.config.ts`, `apps/*/tests/contract`)                                                                                                                               | the app keeps its contract test and calls the kit's runner; keel keeps the fixture's; the reusable workflow brings Postgres. Today only the showcase has one, and `init-app` copies it into the kept app (`scripts/init-app.ts`). The starter gets its own before it becomes the generator's template                                                                                                                            |
| the deployment's fail-closed guard (`packages/keel/src/adapters/production-guard.test.ts` reads `infra/stack.ts` for `APP_MODE: 'real'`)                                                                           | the `KeelApp` construct asserts it at synth over the server function's environment (part 8), and the test points at the construct. `keel-tools` also exports it, with the migrator-bundle check, as functions over a synthesized template, for an adopter's own infra                                                                                                                                                            |
| the lint fences as composed (`tests/lint/*.test.ts`, which lint virtual files through the repo's real config)                                                                                                      | CLI: `keel check-fences` runs the same probes through the adopter's real config, including each `lint-exceptions.mjs` entry (the named file stays exempt, a sibling file does not). The keel-internal cases (`framework-fence.test.ts`, the `packages/keel` cases in the others) stay here                                                                                                                                       |
| the singleton check, one keel instance, a linked seam, versions in step (part 5)                                                                                                                                   | `keel doctor`, run by the app's verify, and in the kit                                                                                                                                                                                                                                                                                                                                                                           |
| demo size (`scripts/check-demo-size.mjs`, `tests/tooling/check-demo-size.test.ts`)                                                                                                                                 | CLI: `keel check-demo-size <bytes>`; the budget stays in the app's `package.json`                                                                                                                                                                                                                                                                                                                                                |
| Mantine CSS pruning (`scripts/vite-prune-mantine-css.ts` and its test)                                                                                                                                             | `@<scope>/keel-tools`, inside the Vite preset                                                                                                                                                                                                                                                                                                                                                                                    |
| static-demo bundle shape (`tests/tooling/static-demo-bundle.test.ts`)                                                                                                                                              | keel-repo-only: it pins how keel's modules are written                                                                                                                                                                                                                                                                                                                                                                           |
| scratch-dir hygiene (`tests/support/tmp-dir.ts`, `scripts/check-tmpdir-leak.mjs`, `keel/no-direct-mkdtemp`)                                                                                                        | `keel-tools` (the helper, importable by any workspace package, and the leak wrapper), preset (the rule)                                                                                                                                                                                                                                                                                                                          |
| doc paths (`tests/docs/doc-paths.test.ts`, `doc-set.test.ts`)                                                                                                                                                      | CLI: `keel check-doc-paths`, configured by the adopter's own doc set, so an adopter keeps the gate the day `packages/keel` leaves the tree. The app guide keel ships is checked in keel's doc set against `apps/starter`                                                                                                                                                                                                         |
| ports, `.claude/launch.json`, `dev:real` preflight, standalone serve, e2e profile (`scripts/ports.mjs`, `print-port.mjs`, `write-launch-json.mjs`, `check-real-env.ts`, `serve-standalone.mjs`, `e2e-profile.mjs`) | CLI, and `ports` also as a JavaScript module, since Playwright configs and contract tests import `originFor` and `portFor`                                                                                                                                                                                                                                                                                                       |
| adopter identity (`tests/docs/adopter-identity.test.ts`)                                                                                                                                                           | dropped: `create-keel-app` writes the owner files from its flags once, and no later merge can bring keel's back                                                                                                                                                                                                                                                                                                                  |
| issue forms (`tests/docs/issue-forms.test.ts`)                                                                                                                                                                     | keel-repo-only                                                                                                                                                                                                                                                                                                                                                                                                                   |
| adoption probe (the `adoption-probe` CI job)                                                                                                                                                                       | replaced by pack and consume (part 7)                                                                                                                                                                                                                                                                                                                                                                                            |
| knip, jscpd, gitleaks, commitlint, lint-staged, Prettier, husky, `.nvmrc`                                                                                                                                          | config files `create-keel-app` writes once; they are the app's from then on                                                                                                                                                                                                                                                                                                                                                      |

### 4. The lint fences

**Split.** Of `eslint.config.mjs`'s 34 blocks, 23 carry a fence: 6 cover only app code, 7 only keel's tree, and
10 both, `keel/public-surface` among them, since it applies to every file.

- **Keel-internal, staying in this repo:** the framework/app fence over `packages/keel` (the app-content
  patterns, `keel/no-dynamic-app-import`, `keel/no-path-to-app-code`), keel/core's framework ban and
  `keel/no-jsx-in-core`, keel's adapter blocks, the fixture's bans, and `keel/public-surface`.
- **App-side, becoming the preset:** vendor SDKs only in `src/adapters/real/` (the static ban and
  `keel/no-dynamic-vendor-import`), the app-adapter rules (registry, fakes, `real/`), the `process.env` and
  run-mode bans, `keel/no-raw-db-handle` with the app's own exceptions, `react/jsx-no-literals` and the
  a11y-literal ban, the `next/font/google` ban, `keel/no-direct-mkdtemp`, the e2e import ban (part 2), and the
  base TypeScript, React and Next config with its carve-outs for tests, stories and migrations.

**Every fence in the preset gets a rule id of its own.** Several are `no-restricted-imports` or
`no-restricted-syntax` settings today, and a later config block that sets either rule replaces the earlier
setting for the files it matches (the merge trap `eslint.config.mjs` warns about). An adopter's own blocks come
after the preset and are free to set either rule, so a fence carried that way could vanish with every check
green. `keel/no-raw-db-handle` was moved to its own id for exactly this reason. `keel check-fences` (part 3)
probes the composed config to prove nothing was replaced.

**One plugin object.** Flat config throws `Cannot redefine plugin "keel"` when two blocks that match the same
file bind `keel` to different objects (`eslint.config.mjs` documents it). This repo's internal blocks and the
preset both bind `keel`, and `keel/public-surface` matches every file. So the published plugin object carries
every keel rule, internal ones included, the preset enables only the app-side ones, and this repo's config
imports that same object. Rule ids stay `keel/…`, and existing disable comments keep working. Some internal
rules read this repo's files when the config module loads (`keel/public-surface` reads keel's `package.json`, and
the fence and exceptions loader resolve paths against the repo root). Inside a published plugin that load would
fail in every adopter's config, so those anchors become rule options, read when a rule runs.

**The preset works from outside the app, per package.** In the spike, a stand-in preset outside the consumer's
directory, as a package in `node_modules` is, used app-relative globs (`src/**`, ignoring `src/adapters/real/**`).
Flat config resolves `files` against the consuming config's directory. In the Pages-shaped workspace, the app
kept its own `eslint.config.mjs` in `apps/console`, and ESLint 10, run from the workspace root, used it for the
app's files: a probe importing `@aws-sdk/client-s3` and reading `process.env` was reported twice in
`src/domain/` and not at all in the app's own `src/adapters/real/` adapter. A whole-app run also showed that a
preset of fences alone is not enough: the base config has to come with it. The preset is a factory,
`configs.app({ root })`. An adopter's app config passes its own directory (`import.meta.dirname`), not `.`,
which would be relative to wherever ESLint was started. keel's root config passes `apps/*`, so the same rules
are proved against both apps before an adopter sees them. #51's
app-owned exceptions stay where #51 put them, `lint-exceptions.mjs` at the app's root, and the preset reads them.

**`keel/public-surface` is redundant for a consumer.** In the spike, TypeScript's `bundler` resolution refused
both an unpublished subpath (`keel/db/migrations/index`) and a deep path (`keel/src/adapters/fake/pglite-dialect`)
with TS2307, because a real `node_modules/keel` has an `exports` map. The rule stays in this repo, where tsconfig
`paths` and the Vite and Vitest aliases send `keel/*` straight to source and bypass the map (ADR-0012's lesson).

### 5. Singleton peers, and one keel

keel already declares `react`, `next`, `next-intl` and `@mantine/core` as `peerDependencies` (ADR-0012, "The
dependency manifest"). Its shipped source imports no `react-dom` and no `@mantine/hooks`. It does import
`kysely` in 31 source files, and an app's migrations receive keel's `Kysely` instance, so `kysely` moves to the
peers, with `@types/react` and `typescript` (part 2).

**What happens on a mismatch.**

- With the app on `react` 19.3.1 and keel's peer at `~19.2.8`, pnpm linked keel to the app's copy (one copy),
  printed a peer warning, and `pnpm peers check` listed it.
- With `react` moved from keel's peers to its plain `dependencies` (the mistake ADR-0012 warns about), install
  succeeded with no warning, and keel got its own `react` 19.2.9.
- Inside this workspace, the dependency group that #36 superseded raised the apps' floors but not keel's peer
  floors. That kept old `next-intl` and `@mantine/core` copies in keel's part of the lockfile, so
  `useTranslations` found no provider while `lint-typecheck-unit` stayed green (build-notes, 2026-11-16).

**`keel doctor`.** It runs in the app's verify and checks:

- **one copy of each singleton**: for every peer keel declares, the real path of the package's directory, found
  from keel's directory, equals the one found from the app's. A peer that cannot be found from keel fails,
  rather than passing. Package directories, not entry points, because `@types/react` has no entry point to
  resolve. In the spike an entry-point version of the check reported one copy of each of `react`, `react-dom`,
  `next`, `next-intl` and `@mantine/core`, and against the `dependencies` mistake it printed `TWO COPIES  react`
  and exited 1. It is the `readlink -f` check build-notes tells a dependency PR to run by hand, made a command;
- **one keel, with its seam**: every workspace package that imports keel itself (not only `keel-tools`) resolves
  the same `@<scope>/keel`, and that keel's seam link points at the app's own `src/app-config`. A package that
  takes keel without linking a seam gets a keel instance with no seam, and since the seam peer is optional,
  nothing else would say so. So every package that imports keel links the seam; packages that only use
  `keel-tools` need neither. Inside this repo the seam goes through aliases, not a link, so doctor has an
  in-repo mode that checks the aliases instead;
- **versions in step**: every installed keel package is the same version as keel (failed, since the packages
  carry no dependency on each other that would keep them together); and, reported rather than failed, the
  release commit keel stamps into its package against the commit SHA the app's workflow pins, and the plugin
  version the repository pins in `.claude/settings.json` against keel's version. Those two are reports because a
  Claude Code plugin is installed per user, and CI and people not using Claude Code have none.

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
  preset in `@<scope>/keel-tools`, as JavaScript.
- **Demo size** becomes `keel check-demo-size <bytes>`, and the number stays in the app's `package.json`, as now.

### 7. CI

**Pack and consume, built first.** A job (and a local script) packs every package, installs the tarballs into a
workspace outside this repo, and runs that workspace's verify. Its first shape is the spike's Pages-shaped one,
built from a copy of `apps/starter`: the app under `apps/<slug>` with its own `src/adapters/real/` adapter,
`lint-exceptions.mjs`, a seam module that imports through the app's `@/` alias (as the showcase's `jobs.ts`
does), and an e2e spec that imports `keel/testing/e2e` and an app domain module; beside it, a sibling package
that imports keel and links the seam, and one that uses only `keel-tools`. Vitest and ESLint run from the
workspace root, as Pages runs them, not only per app. Once `create-keel-app` exists, a second shape is its
output. The verify covers typecheck with part 2's strict flags on, lint with `keel check-fences`, unit tests plus
the kit, `keel doctor`, `keel check-e2e`, `next build` with `E2E_BUILD=1`, e2e (server and static demo), the
static demo's size, and the migrator's bundle with its assertions. Each workspace package depends on the
tarballs it uses directly (`"keel": "file:…/keel-<version>.tgz"`). No overrides are used: pnpm 11 no longer
reads the `pnpm` field of `package.json` at all, and keel's packages do not depend on each other, so there is
nothing to override. The job fails if the lockfile resolves any `@<scope>/*` package from a registry, so it can
never test an older published keel and go green. It is a required check on every PR.

What the spike found is the reason for the job: keel's tests reaching into the repo's `tests/`, `@types/pg`
declared only at the workspace root, transitive build-script approvals that only keel's `pnpm-workspace.yaml`
granted (pnpm 11 failed the consumer's install with `ERR_PNPM_IGNORED_BUILDS` for `@swc/core`), esbuild and tsx
missing the seam, and Node refusing keel's source. None of these can show inside the workspace.

**A reusable workflow, for orchestration only.** It is `on: workflow_call`, so it has no triggers: the caller
keeps its own (Pages: pushes to `main` and `integration`, and pull requests), its own concurrency group, its own
secret scan with its own `.gitleaks.toml`, and its own jobs beside keel's. It takes the app's directory as an
input. It brings the services (a `postgres:16` container for the contract job), the e2e shard matrix discovered
from the app's Playwright config, and the install. Every step's logic is a `pnpm exec keel ci <job>` command,
so it comes from the app's lockfile and cannot drift from the installed packages. An optional `synth` job runs
the app's CDK synth, which is where the construct's assertions run (part 8). Callers pin it by commit SHA, not
by tag, because a tag can be moved and the workflow runs with the caller's secrets. A private repository in
another organization can call a workflow in a public repository when that organization allows public reusable
workflows and the repository's Actions settings allow them; Pages' organization has to.

### 8. Infra

A **`KeelApp` construct**, not a `Stack` and not a CDK app, so that an adopter composes it inside their own
stacks: Pages has its own `PagesEdge` construct, an edge stack and separate CDK apps. Its props are the app's
directory and slug, the database transport (`pg` or `data-api`, #49's two network shapes) and the deployment
params, and it exposes the resources an adopter's own constructs need (the server function, its URL, the
distribution, the cluster).

- **The migrator** is resolved **from the app's directory** (`keel/adapters/real/migrate-handler` as the app
  installed it) and bundled by esbuild. keel-cdk has no dependency on keel (rule 4), so an adopter's `infra`,
  often its own workspace package (Pages' is), never holds a keel instance of its own. The construct **always**
  passes the seam explicitly: `--alias:@<scope>/app-config=<app>/src/app-config`. In a consumer that is redundant
  with the link; in this repo it is required, because there the fallback is the root tsconfig's fixture mapping.
  It asserts that the keel it found is its own version.
- **At synth the construct asserts** that the migrator bundle holds the app's own migrations, and that the
  server function's final environment has `APP_MODE: 'real'` and neither `DEMO_MODE` nor `E2E_BUILD`. The
  first is the check #54 put into `infra/check-shapes.ts`, which reads each Lambda's bundle out of the synthesized
  assembly; the second is the fail-closed guard `production-guard.test.ts` checks today by reading
  `infra/stack.ts`, which no adopter's infra is. That test moves to the construct. `keel-tools` exports both
  checks as functions over a synthesized assembly, so an adopter whose infra does not use the construct (Pages,
  at the switch) still runs them.
- #49's `infra/check-shapes.ts`, which synthesizes both network shapes and, since #54, reads their bundles,
  becomes the package's own test.

### 9. Agent assets

- **A Claude Code plugin**, from a marketplace in this repo, carrying the commands an app author runs
  (`/new-slice`, `/new-entity`, `/new-job` and the other capability scaffolds, `/verify`, `/pre-pr`) and the
  `doc-steward` agent. The maintainer commands stay in this repo: `/new-port` writes a keel port into
  `packages/keel`, which in an adopter's repo is `node_modules`. Commands address the app through its declared
  root (below), not `apps/<app>/…` and not a bare `src/…`, which is wrong from the root of a workspace like
  Pages'. A plugin installs per user from its marketplace, not from the app's lockfile, so the repository pins the
  marketplace ref in `.claude/settings.json` and `keel doctor` reports when that ref and the installed keel
  disagree.
- **`CLAUDE.md` splits in two.** The rules an app author follows (the seam, vendor SDKs, `getDb`, i18n,
  router-agnostic screens, hermetic dev) ship as a markdown file inside `@<scope>/keel`. The adopter's own
  `CLAUDE.md` imports it with Claude Code's `@path` import, relative to the app's directory, since pnpm installs
  keel there under its alias (Pages: `@apps/console/node_modules/keel/…`). A path inside the working directory loads
  without the approval dialog external imports need. The guide an agent reads is then the version the app
  installed. The maintainer half (two apps, the fixture, the fence internals) stays in this repo's `CLAUDE.md`.
- **The app is named where it is used.** Every `keel` command acts on the app in its current directory, or the
  one an `--app` flag names, so each package's own scripts work as they are, and this repo's two apps each run
  their own. A `keel.apps` list in the workspace's `package.json` is only the default for whatever fans out
  across apps: a workspace-wide `keel` run, the plugin's commands and the reusable workflow's input. A workspace
  like Pages', where the app is not at the root, is first-class.

### 10. Releases

- **Changesets, with every package in one fixed group:** one version number for the set, and a generated
  changelog.
- **0.x semantics as npm reads them.** `^0.3.0` accepts only `0.3.x`, so a **minor** is the breaking channel and
  a patch must be compatible. Changesets turns a `major` changeset on 0.x into 1.0.0, so a breaking change is
  filed as `minor`. Because keel's packages carry no dependency on each other (rule 4), no release bumps a
  package by way of another's peer range, which is how a peer-dependent bump could otherwise lift the whole
  fixed group to 1.0.0. As a backstop, since npm versions cannot be withdrawn, CI fails when the computed
  release plan (`changeset status`) contains any version of 1.0.0 or higher.
- **Breaking means:**
    - a seam change (a new required export in an `app-config` module, the kind `docs/adopting.md`'s "When an
      update changes what your seam must say" lists);
    - an `exports` removal;
    - a framework migration that needs operator action;
    - a raised peer floor;
    - a preset rule, kit check, `keel doctor` check or tsconfig-base option that turns existing app code red;
    - a new required environment variable (`REQUIRED_ENV`), secret or IAM permission;
    - a `keel-cdk` change that replaces a stateful resource. A changed logical id replaces the Aurora cluster on
      the next `cdk deploy`. CI snapshots the logical ids of stateful resources and the `REQUIRED_ENV` list, and a
      change to either requires a `minor` changeset.
- **Every changelog entry has a "Seam changes" section and a "Framework migrations" section**, empty or not.
  They replace the merge-time discovery ADR-0013 relied on.
- **Cadence: on demand, at most weekly while 0.x.** Fixes go into the next minor; whether one is also backported
  to the previous minor is D7.
- **The two-consumer rule gates every release:** both apps green and pack and consume green on the release
  commit.
- **Publishing uses the registry's trusted publishing from GitHub Actions (OIDC), with provenance**, so no
  long-lived registry token is stored.
- **Before the registry is chosen** (D1), release candidates ship as tarballs attached to a GitHub prerelease
  of this public repo, installed by URL as each workspace package's direct dependency. The prerelease notes carry
  the same "Seam changes" and "Framework migrations" sections, written by hand until Changesets exists.

### 11. Pages' migration from fork to dependency

The measurement in the Context is the reason this can be early and cheap: Pages has never edited
`packages/keel`. The steps are for exactly Pages' layout, and the spike's last consumer had that shape. Every
reference they edit came from a sweep of Pages' `integration` branch for files outside the ones step 2 deletes
that name something step 2 deletes.

1. **No catch-up merge.** Pages holds its keel merges and takes everything since 24b0589 (#32) through the switch: among it #34's `authorize()` seam changes, #46 and #49's Data API transport, #51's lint exceptions, #52, #53, #54 and the seam rename. The release candidate's notes, whose "Seam changes" and "Framework migrations" cover everything since 24b0589, are its list of seam edits, and `tsc` points at each
   one. Until the switch, Pages' migrator has the bug #54 fixed in keel (step 7).
2. **Delete what keel now ships:**
    - `packages/keel`, and keel's spike: `spikes/kysely-pglite`, its `spikes/*` entry in `pnpm-workspace.yaml`
      and the CI step that tests it;
    - keel's `scripts/` (`init-app.ts`, `check-demo-size.mjs`, `ports.mjs`, `print-port.mjs`,
      `write-launch-json.mjs`, `check-real-env.ts`, `serve-standalone.mjs`, `e2e-profile.mjs`,
      `check-tmpdir-leak.mjs`, `vite-prune-mantine-css.ts`). Pages' own `infra/scripts/` stays;
    - keel's own gates in `tests/` (`tests/lint`, `tests/tooling`, `tests/docs`, `tests/support`). Pages' own
      `tests/lint/pages-maintainer-db.test.ts` goes with its harness (`tests/lint/lint-text.ts`), because
      `keel check-fences` now probes each `lint-exceptions.mjs` entry;
    - keel's docs (ADRs, recipes, runbooks, doctrine), served by keel by version; keel's maintainer commands in
      `.claude/commands` (`/new-port` writes into `packages/keel`) and keel's `.claude/future-tasks`, keeping
      Pages' own;
    - the `.gitleaks.toml` allowlist entry for keel's `packages/keel/src/service-auth/webhook.test.ts`.

    **Keep every file `create-keel-app` would write for an adopter**, even where Pages' copy is identical to
    keel's: `.husky/`, `commitlint.config.mjs`, `lint-staged.config.mjs`, `.prettierrc.json`, `.prettierignore`,
    `.editorconfig`, `.nvmrc`, `.gitleaks.toml`, `.jscpd.json`, `knip.json`, the issue templates and owner files.
    Those are the adopter's from now on.

3. **Install the release candidate**, by tarball URL, as direct dependencies, and drop the root's and
   `apps/console`'s `"keel": "workspace:*"`:
    - `apps/console`: `keel` (the alias of `@<scope>/keel`), `@<scope>/keel-tools`, `@<scope>/eslint-plugin-keel`,
      and the seam link `"@<scope>/app-config": "link:./src/app-config"`, with
      `apps/console/src/app-config/package.json`;
    - the root: `@<scope>/keel-tools`, because the root Vitest configs and scripts use it;
    - `packages/cli`: `@<scope>/keel-tools`, for its tests' temp directories. It takes no keel and links no seam.
      `infra` takes `@<scope>/keel-tools` for the template checks, and `@<scope>/keel-cdk` once it adopts the
      construct; neither brings keel. Any package that does import keel itself also links the seam (part 5);
    - the root `package.json`: `packageManager` and `engines` for pnpm 11, and `keel.apps: ["apps/console"]`;
      `pnpm-workspace.yaml`: the `allowBuilds` entries keel's dependencies need.
4. **Config and imports, per package.**
    - `apps/console/eslint.config.mjs` is the app preset plus Pages' own blocks. `apps/console/lint-exceptions.mjs`
      lists `src/domain/pages/maintainer-db.ts` with its reason, replacing the exception in the root config.
    - `apps/console/tsconfig.json` extends the base (it includes `../../packages/keel/src` today).
      `next.config.ts` (it points next-intl at `../../packages/keel/src/i18n/request.ts`) and
      `vite.demo.config.ts` (it aliases `keel` to `packages/keel`) use the presets. The app's Vitest project uses
      its preset, and one test file in the app calls the kit.
    - `apps/console/package.json`'s `dev` and `start` scripts take their port from `keel port` instead of
      `../../scripts/print-port.mjs`, and `check:demo-size` runs `keel check-demo-size 843000`.
    - `apps/console/playwright.config.ts` imports `originFor`, and both contract tests import `portFor`, from
      `keel-tools`' ports module instead of `../../scripts/ports.mjs`.
    - The nine tests that import `makeTestTmpDir` or `makeTestTmpDirAsync` from `tests/support/tmp-dir` take them
      from `keel-tools`: five in `apps/console/src/domain/pages/*.db.test.ts`, the two contract tests, and
      `packages/cli`'s `cli.test.ts` and `credentials-file.test.ts`.
    - The root `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `vitest.contract.config.ts`, `knip.json`
      and `.jscpd.json` lose their entries for `packages/keel`, its test fixture and `spikes/`, and keep Pages'
      own workspace: `apps/console`, `packages/gate`, `packages/cli`, `infra`.
    - Comments in Pages' code that cite keel's paths (`apps/console/src/adapters/real/storage.ts`,
      `src/app-config/messages.ts`, `config/params.ts`) now name files in keel's repo, not Pages'. No gate reads
      code comments; reword them when convenient.
5. **Root scripts, and the scripts CI runs.** `init-app` goes; `pages` and `dev:edge` stay. `prepare` calls
   `keel launch-json` instead of `scripts/write-launch-json.mjs`, and `test:unit`, `test:coverage` and
   `test:contract` run through `keel-tools`' leak wrapper instead of `scripts/check-tmpdir-leak.mjs`. Pages' CI
   runs `lint`, `typecheck`, `test:coverage`, `knip` and `jscpd`, never `verify` (only its adoption probe did,
   and that goes), so the new gates go into scripts CI runs: `lint` adds `keel check-fences` and
   `keel check-doc-paths`, and `test:coverage` and `test:unit` add `keel doctor` and `keel check-e2e`. `verify`
   keeps fanning out over the whole workspace.
6. **CI.** `checks.yml` keeps its triggers, its concurrency group and its gitleaks job. The `adoption-probe` job
   and the keel spike's step go. Its other jobs keep running Pages' scripts until the reusable workflow exists,
   and then call it for keel's jobs beside Pages' own.
7. **Infra stays Pages', with two edits.** Its `infra/` is already its own composition (`PagesEdge`, the edge
   stack, the conformance scripts, separate CDK apps).
    - Its keel-derived `infra/stack.ts` bundles the migrator from
      `../packages/keel/src/adapters/real/migrate-handler.ts` with the root tsconfig, and Pages' root tsconfig
      maps `@app-config/*` to keel's test fixture, so today Pages' migrator ships the fixture's three `dockets`
      migrations and none of the console's. The entry is re-pointed at the keel `apps/console` installed, with the
      seam alias.
    - Its infra tests run both of `keel-tools`' assembly checks: the migrator bundle holds the console's
      migrations, and the server's environment is fail-closed. That replaces `production-guard.test.ts`, which
      read `infra/stack.ts` and leaves with `packages/keel`.

    It moves the stack onto the `KeelApp` construct when that lands.

8. **Agent rules and the rest of the 18.** Pages' `CLAUDE.md` is keel's text, citing `packages/keel`,
   `scripts/` and `tests/support`, and `keel check-doc-paths` reads it. At the switch it keeps Pages' own rules
   and imports keel's app guide, which ships in the release candidate. The other 17 files Pages edited on purpose (the Context's split) stay Pages': its CI, its configs' entries for `gate`, `cli` and `infra` (moved into its own blocks beside the presets), its `pages` script, its gitleaks entry, its `README.md`, `LICENSE` and owner details. So do files keel never had: its cutover checklist's own rows and `docs/keel-readme.md`. The 47 that `init-app` wrote are deleted or replaced in steps 2 and 4.
9. **Then:** `pnpm install`, `pnpm verify`, the contract tests and `pnpm --filter infra synth`.

**A script?** Not a shipped one: there is one adopter. Two one-off inventories drive the steps above, and both
are worth re-running in Pages at the switch: the classification behind the Context's counts (identical, an older
keel version, `init-app` output or Pages' own, by blob), and the sweep for references to what step 2 deletes.

### 12. Open decisions for JP

These are listed with recommendations under "Open decisions for JP" below.

## Alternatives considered

1. **Stay on fork and merge, and keep fixing friction.** Each fix this week was real and cheap (#31, #39, #51).
   The cheapest serious version of this path is **rewrite-free adoption**: make every scaffold file
   app-agnostic, so `init-app` rewrites nothing outside the app's directory (the app list, the contract app, the
   tsconfig and infra literals move into the app or into config the app owns), and give the two record files a
   `merge=union` attribute. Measured against Pages, that removes the 47 files `init-app` wrote. It leaves the 18 Pages edited on purpose (its CI, its ESLint, knip, TypeScript and Vitest configs, `package.json`, `CLAUDE.md`, `README.md`, `LICENSE`), and a keel change to any of them still conflicts. It also
   leaves a fork with no version to pin or roll back, no way to take one fix without the whole merge, and every
   friction fix itself a change to scaffold files that conflicts on its way in. Worth doing only if this ADR is
   rejected.
2. **Publish only `packages/keel`, and keep the scaffold by fork.** It fixes the half that already merges cleanly
   (0 local edits in Pages) and leaves the 65-file half.
3. **A git subtree or submodule for `packages/keel`.** The same result as 2, with tooling adopters tend to resent.
4. **A template updater for the scaffold** (three-way diffs of the template, as cruft and copier do). It is still
   one merge per file the adopter edited. `create-keel-app` writes the files that must stay app-owned config
   once, and they rarely change.
5. **Option A or option B for the seam**, and **compiled from day one** (parts 1 and 2).

## Consequences

- An adopter's repository is their app, their own packages and thin config. An upgrade is `pnpm up` and reading
  the changelog's "Seam changes". There are no merges, and a fix arrives without the rest of upstream.
- keel pays ADR-0013's predicted cost (semver judgement, a changelog, deprecation windows), now that there is a
  consumer to pay it for.
- keel can no longer quietly depend on its own workspace: tests importing the repo's `tests/`, `@types` declared
  at the root, a root tsconfig deciding the seam, scaffold handing keel's source to Node. Pack and consume makes
  each of those red on the PR that introduces it.
- ADR-0012's seam keeps its shape, and its specifier is renamed (an addendum, if this is accepted).
- An adopter cannot edit keel in place. ADR-0013 already said a keel change must never be carried locally, and
  `pnpm patch` is the emergency valve while the fix goes upstream.
- Retired when `create-keel-app` ships: `init-app`, the adoption probe and the adopter-identity test. The fork
  sections of `docs/adopting.md` are rewritten around the generator, and ADR-0013 becomes Superseded once Pages
  has switched. The doc gate's rule for reference-app citations in merged-in docs then serves only this repo.

## Open decisions for JP

- **D1 — Registry. Recommend public npm.** keel's repo is public and MIT. GitHub Packages' npm registry requires
  an access token, a classic personal access token, to install even a public package, so every adopter's machine
  and CI would need one. Choose GitHub Packages only if keel should stay private during 0.x. Either way, Pages
  switches on release-candidate tarballs (D5) before this is decided.
- **D2 — Scope and names. Recommend an npm organization scope that keel owns, chosen first.** Checked read-only
  on 2026-11-17: `keel` is taken (teamkeel's backend framework, version 0.505.0, published that day), and so are
  `create-keel-app` and `keeljs`. The seam's name must be scoped (part 1), and the rename writes the scope into
  every seam import and into the package's own name, so it comes before anything else. `@keel/core` and
  `@keel/eslint-plugin` return 404, but whether an organization owns `@keel` cannot be checked anonymously.
  Consumers keep writing `keel/…` through a package alias (`"keel": "npm:@<scope>/keel@^0.1"`); inside this repo
  the apps use `"keel": "workspace:@<scope>/keel@*"`. The rename step verifies the alias with peers,
  `transpilePackages` and the CLI.
- **D3 — Licence and copyright line. Recommend deciding before the first release-candidate tarball, with
  counsel.** Today it is MIT, "Copyright (c) 2026 JP Slavinsky". A tarball on a GitHub release is a published copy, so it carries the line too. Pages' own `LICENSE` already reads "Copyright (c) 2026-present Rice University" above keel's line, so the owner of the adopter's copyright and the owner of keel's are already two parties.
- **D4 — Does this repo keep the showcase? Recommend yes**, as the reference app, the public demo and the first
  of the two consumers. It is never published. `create-keel-app` has no eject: its template is `apps/starter`,
  copied when the generator is packed, so the template is always the app the two-consumer rule tests.
- **D5 — When Pages switches. Recommend at the first release candidate (step P7 below)**, on prerelease
  tarballs, without waiting for D1, the generator or the CDK construct.
- **D6 — Release age for keel's own packages.** Pages' install (inherited from keel's
  `pnpm-workspace.yaml`) refuses versions published less than two days ago (`minimumReleaseAge: 2880`), which
  holds a keel fix back two days. Recommend exempting `@<scope>/*` there, since keel's releases are gated by
  this repo's CI.
- **D7 — Backports. Recommend none during 0.x**: fixes go into the next minor, and an adopter on an older minor
  upgrades. Revisit when there is a second external adopter.

## Implementation plan

Each step is one PR and leaves both apps green, because each moves the in-repo apps onto the new piece in the
same PR, and from P1 on pack and consume proves the piece the way an adopter gets it. **D2 blocks P3 and P4.
D3 blocks P7. D1 blocks P14.**

| Step | PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Depends on    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| P1   | **Pack and consume.** The job and a local script: pack keel, build the Pages-shaped workspace from a copy of `apps/starter` outside the repo (part 7), and run its verify (typecheck, unit tests, keel's five seam-conformance suites run from the tarball, `next build`, e2e, the static demo, the migrator bundle). It lands green by naming today's gaps as workarounds, each tied to the step that removes it: for example the seam aliases (P3), `@types/pg` added by the consumer (P2), the copied prune plugin, `ports.mjs`, `print-port.mjs` and `check-demo-size.mjs` (P4), the next-intl request path written into `node_modules` (P4), and the skipped `demo-presets-seam` suite (P2). | —             |
| P2   | **Package hygiene.** A `files` allowlist that still ships the five seam-conformance suites until P5 replaces them; keel compiling under part 2's strict flags, and the consumer typechecked with them on; `@types/react`, `typescript` and `kysely` as peers, the other `@types` as dependencies; the helpers 23 of keel's tests import from the repo's `tests/support`, moved into keel. `private` stays until P14.                                                                                                                                                                                                                                                                              | P1            |
| P3   | **Rename the seam and the package.** `@app-config/*` becomes `@<scope>/app-config/*` and `packages/keel` becomes `@<scope>/keel` (in-repo apps: `"keel": "workspace:@<scope>/keel@*"`), by codemod across keel's source, tests and fixture, both apps' aliases, the root tsconfig, both Vitest configs, the lint fence and its tests, and the docs; then grep for the old tokens. The seam peer is optional. Pack and consume switches to the link and to the `npm:` alias, and checks that keel's peers resolve through the alias.                                                                                                                                                               | P1, D2        |
| P4   | **`@<scope>/keel-tools`**, as JavaScript, with no dependency on keel: the `keel` CLI (demo size, ports, launch config, `dev:real` preflight through esbuild, standalone serve, e2e profile, the temp-dir leak wrapper, `check-doc-paths`, `ci <job>`), the helpers any workspace package may import (`makeTestTmpDir`, the ports module, the two assembly checks), the Next, Vite and Vitest presets, and the tsconfig base. Both apps switch; `scripts/` keeps only what is keel's own. It comes before P5 and P6, whose checks are `keel` commands.                                                                                                                                             | P2, D2        |
| P5   | **The conformance kit at `keel/testing`** (the mutation scan per app root with app-owned exemptions and their staleness check, i18n partition and parity, the pglite RLS runner, migration order, demo presets, the seam-map check, the seam-free `keel/testing/e2e`), **`keel doctor`** and **`keel check-e2e`** (with an in-repo mode, since here keel's files are under `packages/keel/src`). Each app runs the kit from its own test file, as a consumer will, instead of `vitest.config.ts` including keel's test files, and the showcase's specs move onto `keel/testing/e2e`; the `files` allowlist then drops keel's tests.                                                               | P2, P3, P4    |
| P6   | **`@<scope>/eslint-plugin-keel`**, as JavaScript, with no dependency on keel: one plugin object with every rule, every app-side fence under its own rule id, repo anchors as rule options, `configs.app({ root })`, and `keel check-fences`, which also probes each `lint-exceptions.mjs` entry. This repo's config imports the same object. Pack and consume lints from the workspace root and from the app.                                                                                                                                                                                                                                                                                     | P3, P4        |
| P7   | **The first release candidate.** Pack and consume attaches its tarballs to a GitHub prerelease, whose notes carry hand-written "Seam changes" and "Framework migrations" since 24b0589 and the install lines for each workspace package. keel's app guide (the app-facing half of `CLAUDE.md`) ships inside keel from here, checked by the doc gate against `apps/starter`. **This is the first step that lets Pages switch**: it needs no registry, no generator, no CDK construct and no reusable workflow.                                                                                                                                                                                     | P5, P6, D3    |
| P8   | **Pages switches** (in `safeinsights/pages`, part 11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P7            |
| P9   | **`@<scope>/keel-cdk`**, as JavaScript, with no dependency on keel: the `KeelApp` construct (both transports), the migrator resolved from the app with the explicit seam alias, the synth assertions (the app's migrations, the fail-closed environment, the app's keel at the construct's own version), `check-shapes` as its test, and the production-guard test moved onto it. `infra/` becomes an instantiation for the showcase. Pages adopts it when it chooses.                                                                                                                                                                                                                            | P3, P4        |
| P10  | **The reusable workflow** (orchestration only, the apps input, an optional `synth` job), called by this repo's own CI for both apps, pinned by SHA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P4, P5, P6    |
| P11  | **The starter's own contract project and database, and its own `params.ts`**, so the generator's template carries the gates `init-app` used to copy from the showcase. It closes `.claude/future-tasks/contract-suite-single-app.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —             |
| P12  | **`@<scope>/create-keel-app`**: the starter template plus generated config (presets, the seam link, `allowBuilds`, `keel.apps`, a workflow calling the reusable one, the owner files from flags). Pack and consume gains its second shape. `init-app`, the adoption probe and the adopter-identity test are retired in the same PR.                                                                                                                                                                                                                                                                                                                                                               | P4–P6, P9–P11 |
| P13  | **The Claude Code plugin** (the app-author commands; the maintainer ones stay), and this repo's `CLAUDE.md` cut to the maintainer half, importing the app guide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P12           |
| P14  | **Registry releases**: Changesets in a fixed group, with `major` changesets and any release plan reaching 1.0.0 rejected on 0.x; the logical-id and `REQUIRED_ENV` snapshots; trusted publishing with provenance; then 0.1.0. JP sets up the registry's trusted publisher for this repository.                                                                                                                                                                                                                                                                                                                                                                                                    | P10, D1–D3    |
| P15  | **ADR-0013 Superseded** and `docs/adopting.md` rewritten around the generator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P8, P12       |

P1, P2 and P11 can start before D2 is decided, P4 as soon as D2 is, and P9, P10 and P11 can run beside the steps on Pages' path.
**Pages' critical path is D2, P3, then P5 and P6, P7, P8**, with P1, P2 and P4 first or alongside. P4, P5 and P6 all touch the
root `package.json`, the lockfile and `knip.json`, so they land one after another, not at once.
