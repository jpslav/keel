# ADR-0014 — keel ships as versioned packages, renamed SSSB: the framework, its fences and its scaffold

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

**keel is renamed SSSB** (JP, 2026-11-17, D2 below): `keel` on npm is another project's active backend
framework, and a rename costs least now, before anything is published and before Pages switches. The letters
are deliberately left undefined. This ADR says keel for the project as it stands and SSSB for what it will
publish. Every package is scoped, under the `@sssb` npm organization, which only its members can publish into.
The framework is `@sssb/core`, and apps import it directly (`@sssb/core/ports/…`); the generator is
`@sssb/create`, which `npm create @sssb` and `pnpm create @sssb` run. So owning the scope reserves every name
at once, which is step zero (P0), and no name outside it needs defending:

| In a fork today                                                | Becomes                                                          | Delivered as                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/keel`                                                | the framework, plus a conformance kit at `@sssb/core/testing`    | `@sssb/core`, imported as `@sssb/core/…`                           |
| the fences in `eslint.config.mjs`                              | an ESLint plugin with an app preset                              | `@sssb/eslint-plugin`                                              |
| root `tsconfig.json`, the Next/Vite/Vitest configs, `scripts/` | a tsconfig base, config presets and an `sssb` CLI                | `@sssb/tools`                                                      |
| the root `infra/` (the showcase's deployment)                  | a CDK construct an adopter composes, and each app's own `infra/` | `@sssb/cdk`; `apps/<app>/infra/`                                   |
| `pnpm init-app <slug> --eject-showcase`                        | a generator whose template is `apps/starter`                     | `@sssb/create` (`npm create @sssb`)                                |
| `.claude/commands`, `.claude/agents`, `CLAUDE.md`'s rules      | a Claude Code plugin, and an app guide inside the package        | a plugin marketplace in this repo; a markdown file in `@sssb/core` |
| `.github/workflows/checks.yml`                                 | a reusable workflow the app's own workflow calls                 | `safeinsights/sssb/.github/workflows/…`, pinned by commit SHA      |
| the `@app-config/*` seam                                       | a package the app provides and links, never published            | `@sssb/app-config`                                                 |

**How the name was chosen.** The first choice, strake, was dropped the same day. The independent design review
found that an npm organization `strake` already exists and is not JP's (the registry answers
`/-/org/strake/package` with 200), and that Strake is an existing project, a Rust native-app runtime published
as `@strake-dev/strake` since September 2026. JP then chose SSSB. Checked on 2026-11-17: `sssb`, `create-sssb`
and the four `@sssb/*` names the ADR then used were unpublished, the registry had no `sssb` organization
(`/-/org/sssb/package` answered 404), and npm's search found no similar package. The organization was then
created the same day, by the SafeInsights `safeinsights-bot` npm account, and the same endpoint now answers 200.
npm's publish check judged the unscoped name differently: publishing `sssb` was refused with a 403, "Package
name too similar to existing packages ssri, ssh2, ses, sass, scss, jss, csso, xss, css", its rule against
names a typo away from popular packages. Nothing was published. So every package is scoped: the framework
became `@sssb/core` and the generator `@sssb/create`, and `create-sssb` was dropped. The organization's package
list (`/-/org/sssb/package`) then named `@sssb/core`, `@sssb/create`, `@sssb/tools`, `@sssb/eslint-plugin` and
`@sssb/cdk`; `@sssb/app-config` stays unpublished. On GitHub a few small, unrelated repositories use the
letters, some of them watchers for SSSB, the Stockholm student-housing foundation: a different field, and a low
risk.

**The rename does not rewrite history.** ADRs 0001–0013 and their addenda, `docs/decision-log.md`, `docs/build-notes.md` and this ADR's own evidence say keel. They were true when written, and in them keel means the project now called SSSB. The rename step (P1) rewrites what is current: the doctrine docs, `CLAUDE.md`, every identifier, package name and lint rule id, and the commands and agent. From then on, new records say SSSB.

**The project moves to a new home** (JP, 2026-11-17, D10 below). `jpslav/keel` is left as it is: a last commit points its README at the new repository, and then it is archived, read-only, so every old link still resolves. The project continues in `safeinsights/sssb`, created with a copy of the full git history, so every commit and its author are kept. Creating it is JP's action, or is done with JP's explicit go, and the rename is the first PR there (P1). PRs there are opened through the si-bob relay and approved and merged by `jpslav`, as in every SafeInsights repository today.

**Old PR numbers.** The new repository numbers its PRs from 1 again, so a bare `#54` written here would name the wrong PR there. The rename PR qualifies the PR references in the doctrine docs, which describe the present (`#54` becomes `jpslav/keel#54`). The dated records are append-only, so they keep their bare numbers, and each gets an appended entry at the move saying that the numbers above it refer to `jpslav/keel`.

**Maintained by SafeInsights, not specific to it** (JP, 2026-11-17, D9 below). SafeInsights maintains SSSB, and SSSB is not SafeInsights-specific. The guard is the universality test in `docs/development-approach.md` ("What the template ships"): vendor code ships only if every instance will use it or if it demonstrates a class of integration the template does not yet teach, a component only if it encodes a framework invariant, and anything else is a recipe. The rename PR puts the same sentence in `README.md`, `CONTRIBUTING.md` and `docs/README.md`.

**Will the starter and showcase use SSSB the way an adopter does? Yes.** Every step of the plan moves both
in-repo apps onto the new piece in the same PR. They consume SSSB through workspace links
(`"@sssb/core": "workspace:*"`) and the same presets, ESLint plugin, CLI and conformance kit an adopter uses, so
each piece is proved against two apps before an adopter sees it. Only resolution differs here: workspace links
instead of tarballs, and per-app aliases for the seam (part 1). That difference is why pack and consume proves
the packed artifact separately, on every PR. The starter also becomes `@sssb/create`'s template, copied
when the generator is packed, so what new adopters start from is the app this repo tests.

The rules that come with it, each argued in the hard parts below:

1. **The seam becomes a package the app provides** (part 1, option C). Its specifier is renamed from
   `@app-config/*` to `@sssb/app-config/*`. Nothing else about ADR-0012's seam changes.
2. **`@sssb/core` ships TypeScript source for 0.x, and every other package ships JavaScript** (part 2).
   Its source is only ever compiled by `tsc` or a bundler. Whatever Node loads directly is JavaScript, SSSB's one compiled entry point (`@sssb/core/testing/e2e`) included.
3. **pnpm 11 or later is a requirement for adopters.** Option C rests on pnpm's `link:` protocol and its peer
   linking, and `allowBuilds` is pnpm's.
4. **Only `@sssb/core` is imported at run time, and the other SSSB packages do not depend on it.** The ESLint plugin, `@sssb/tools`, `@sssb/cdk` and `@sssb/create` reach SSSB, where they need it at all, from the app's own directory. All of them are versioned in lockstep, and `sssb doctor` checks that the installed versions match (parts 5 and 10). One SSSB instance per app; one version number for the set. The rule is load-bearing: the independent review ran a stand-in tools package doing a bare `import('@sssb/core/…')` from one app, and it loaded the other app's `@sssb/core` through pnpm's hoisted `.pnpm/node_modules`; resolving from the app's directory loaded the right one. So every resolver in `@sssb/tools` (the CLI, the Vitest preset's kit entry, the Next preset's request config) resolves `@sssb/core` with the app's directory as its base (`require.resolve(…, { paths: [appDir] })`), and all of them share one check: the real path of what they loaded equals the real path of `@sssb/core` resolved from the app's directory.
5. **Pack and consume is the first thing built, and a required check on every PR from then on** (part 7). It
   packs the packages and installs the tarballs into an adopter-shaped workspace outside this repo, and that
   workspace's verify must pass. Inside this repo, workspace links hide exactly the failures it catches.
6. **Everything SSSB ships is composed by the adopter, never adopted wholesale**: an ESLint preset beside their
   own rules, a CDK construct beside their own stacks, a reusable workflow called from their own workflow
   beside their own triggers and jobs.
7. **Pages switches from fork to dependency once, early, on release-candidate tarballs** (part 11), before any
   registry exists. New adopters start from `@sssb/create`. Fork and merge ends when Pages has switched.

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
declare module '@sssb/core/app' {
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

The generator also copies the app's own `type` into it: a nested `package.json` resets the module type for everything under `src/app-config`, so without the same `type` the seam would be compiled as a different module type from the rest of the app.

pnpm linked the peer into keel's own `node_modules`, pointing at the app's `src/app-config`, and every tool
resolved it through ordinary package resolution, with **every** `@app-config` alias removed: `tsc`,
`next build`, Vite, Vitest, esbuild with no alias and no tsconfig (the migrator bundle held the app's
`1001_items`), and tsx. The same held in the Pages-shaped workspace, with the app at `apps/console`: the peer
linked to `apps/console/src/app-config`. It keeps ADR-0012's seam as decided: plain modules, imported directly,
checked by the compiler, one module per capability. In that workspace, a second app linking its own seam got a second keel instance in the virtual store, each linked to its own app's `src/app-config`.

What C costs:

- **The rename.** `@app-config/db/migrations` parses as a package named `@app-config/db`, so the seam has to
  become ONE package with subpaths: `@sssb/app-config/*`. It is a codemod across keel's source, tests and
  fixture, both apps' aliases, the lint fence and the docs.
- **A `package.json` in each app's `src/app-config`, and a `link:` dependency.** `@sssb/create` writes both.
  Its `exports` map has to cover every seam module keel imports. The `./*` pattern covers flat `.ts` modules
  only, so a `.tsx` module or a directory module needs its own entry, as `db/migrations` does. The kit checks
  that every seam specifier keel imports resolves through the app's map.
- **The name must sit in a scope keel owns.** In the option-C consumer, `pnpm add` requested `keel-app` from the
  npm registry (404). An unscoped seam name that somebody else later published could install a stranger's
  package where the app's registrations belong. The peer is also marked optional in `peerDependenciesMeta`:
  pnpm's `autoInstallPeers` installs only missing non-optional peers, so it never fetches the seam on its own.
  `sssb doctor` (part 5) then fails if the seam is not linked, since an optional peer no longer warns.
- **pnpm only.** npm rejects the `link:` protocol, and under npm the seam would resolve only by hoisting.
  Hence rule 3.
- **Inside this repo, resolution still goes through aliases.** A bare specifier resolved from `packages/keel`
  can name only one app, which is ADR-0012's reason for one Vitest project per app. So the per-app aliases
  stay, with the new key, and decide it here exactly as now. pnpm's `injected` workspace dependencies would let the two apps resolve the seam by link, as an adopter does; they are not used because pnpm installs an injected dependency as a hard-linked copy, so a new file, or one an editor saves by replacing it, does not reach the apps until the next install. Anything that builds keel without them in this
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

**Answer: `@sssb/core` ships TypeScript source for 0.x, consumed only through `tsc` and bundlers.** That is
what both apps compile against today. It comes with:

- a `files` allowlist;
- **keel compiling under a named set of strict options**, so that an adopter who turns any of them on cannot
  break keel: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and `erasableSyntaxOnly`, which give 26, 24, 58 and 8 errors in keel's non-test source at 6d67a7c. `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch` give none. Code that passes
  a flag still compiles with it off. Pack and consume typechecks its consumer with the whole set on, so the set
  is a tested promise, not a hope;
- a floor for `lib` and `target`, ES2022, named in the same contract: keel's source uses `Object.hasOwn`, `.at()` and `Error`'s `cause`, and the independent review measured 15 errors inside it under `--lib es2020`, which `skipLibCheck` cannot silence. Pack and consume typechecks at the floor too;
- the `@types` keel's source needs: those of host singletons (`@types/react`) and `typescript` as peers, with
  keel's tested ranges, and the rest (`@types/pg`) as dependencies. Two `@types/react` trees would split
  keel's JSX and the app's the way two copies of React split context, and no runtime check sees it;
- a tsconfig base in `@sssb/tools` that the app extends;
- `transpilePackages` set by the Next preset.

**Every other package ships JavaScript**: the ESLint plugin, `@sssb/tools`, `@sssb/cdk` and `@sssb/create`,
since Node loads them directly. They may be written in TypeScript and built when packed. **What reaches keel
from a Node-loaded context goes through a bundler or a compiled entry point.** The CLI runs keel code through
esbuild. Playwright loads e2e specs with Node, so an e2e spec may reach keel only through `@sssb/core/testing/e2e`,
which the kit ships compiled. That entry point is seam-free: keel's `webhook-signing` reads `APP_SLUG` from the
seam when it loads, so the signature check is split from the header constants, and packing fails if the
compiled entry imports the seam. A lint ban on direct imports is not enough, because a spec reaches keel
indirectly too: the showcase's `tickets-pagination.spec.ts` imports the app's `src/domain/tickets`, which
imports `keel/core/state-machine`. So `sssb check-e2e` bundles each spec with esbuild and fails if any keel file
other than `@sssb/core/testing/e2e` is reached.

**Keel code is always bundled or compiled.** Even a compiled keel under plain Node would load the app's seam
with Node's resolver, which needs file extensions the seam does not write (`./1001_items`) and ignores tsconfig
`paths` the seam does use (`@/jobs/…`). So compiled output for the framework is a later step, and its trigger is
build cost (type-checking keel's source in every app), not compiler options. Under C that step does not touch
the seam.

### 3. The gates that walk the app

Each gate becomes part of a **conformance kit** (helpers at `@sssb/core/testing`, or an `sssb` CLI command the app's
verify calls), stays **keel-repo-only**, or is **dropped**. keel's seam-conformance suites already run from
`node_modules` against a consumer's seam: 4 of the 5 files passed (13 tests) unmodified. The fifth,
`demo-presets-seam.test.ts`, failed only on its import of `../../../../tests/support/tmp-dir`, a path outside
the package. 23 of keel's 57 test files import from the repo's `tests/` that way, so the kit's first job is to
own its helpers. Every kit check and CLI command runs per package, from the app's own directory, so an adopter's
workspace can hold packages that are not apps (Pages' `gate` and `cli`). **The kit runs by default.** Today `vitest.config.ts` includes the conformance suites, so the authorization scan and the RLS suite cannot be dropped by forgetting them. After the switch the same must hold: the Vitest preset adds the kit's entry point to Vitest's `include` itself, by absolute path, resolved from the app's directory (rule 4), with named opt-outs as the only way to leave a check out. Whether the kit runs is checked statically, not from a record of an earlier run: `sssb doctor` resolves the app's Vitest config and fails unless it includes the kit's entry with only named opt-outs, and the entry fails its run if a registered check is skipped without an opt-out. Helpers that do not touch the seam live in `@sssb/tools`, not the kit, so such a package uses them without taking keel: Pages' `cli` tests import
`makeTestTmpDir`, and its `infra` would run the template checks.

| Gate                                                                                                                                                                                                               | Becomes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck of ALL of keel against each app (the starter's `tsconfig.json` includes `packages/keel/src`)                                                                                                             | keel-repo-only: the two-consumer rule. A consumer typechecks the keel it reaches                                                                                                                                                                                                                                                                                                                                                 |
| authorized-mutations scan (`packages/keel/src/authz/authorized-mutations.test.ts`)                                                                                                                                 | kit: a scan of the app's own `src/app`, honouring app-owned exemptions (each with its required `mustMatch`, read from the app the way #51's `lint-exceptions.mjs` is), since an adopter can no longer edit keel's map. An app-owned exemption that matches no file in the app's tree fails, so a deleted route's exemption cannot wait for a new route at the same path. keel keeps the fixture root and its own staleness check |
| i18n partition and parity (`packages/keel/src/i18n/*.test.ts`)                                                                                                                                                     | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| the composed pglite RLS suite (`packages/keel/src/db/rls-pglite.test.ts`)                                                                                                                                          | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| migration numbering and upgrade order (`packages/keel/src/db/migrate.test.ts`)                                                                                                                                     | kit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| demo-presets conformance (`packages/keel/src/server-lib/demo-presets-seam.test.ts`)                                                                                                                                | kit, once its temp-dir helper moves into the package                                                                                                                                                                                                                                                                                                                                                                             |
| RLS contract on real Postgres (`vitest.contract.config.ts`, `apps/*/tests/contract`)                                                                                                                               | the app keeps its contract test and calls the kit's runner; keel keeps the fixture's; the reusable workflow brings Postgres. Since #62 every app runs its own contract suite, each in its own database, and the starter has its own `config/params.ts`, so the generator's template carries both                                                                                                                                 |
| the non-superuser owner pass (`packages/keel/src/db/owner-pass.ts`, #53): keel's migrations and RLS proofs run as a database owner that is not a superuser, as Aurora's master user is                             | kit: the contract runner runs it over the app's own tables. Without it an adopter's tables are proven only as a superuser, the condition that hid #53's bug                                                                                                                                                                                                                                                                      |
| the Data API contract suite and its emulator (`packages/keel/src/adapters/real/rds-data.contract.test.ts`, `rds-data-emulator.ts`, #46)                                                                            | kit: the contract runner proves the app's tables over the Data API transport too, against the emulator, which ships under `@sssb/core/testing`. Pages reaches Aurora through the Data API                                                                                                                                                                                                                                        |
| the cutover checklist (`docs/cutover-checklist.md`): rows such as `db-role-not-superuser` that must hold before production                                                                                         | `@sssb/core` ships its rows as data with ids; every release's changelog has an "Operator actions" section; `sssb doctor` reports framework rows the adopter's own checklist has not recorded                                                                                                                                                                                                                                     |
| the deployment's fail-closed guard (`packages/keel/src/adapters/production-guard.test.ts` reads `infra/stack.ts` for `APP_MODE: 'real'`)                                                                           | the `SssbApp` construct asserts it at synth over the server function's environment (part 8), and the test points at the construct. `@sssb/tools` also exports it, with the migrator-bundle check, as functions over a synthesized template, for an adopter's own infra                                                                                                                                                           |
| the lint fences as composed (`tests/lint/*.test.ts`, which lint virtual files through the repo's real config)                                                                                                      | CLI: `sssb check-fences` runs the same probes through the adopter's real config, including each `lint-exceptions.mjs` entry (the named file stays exempt, a sibling file does not). The keel-internal cases (`framework-fence.test.ts`, the `packages/keel` cases in the others) stay here                                                                                                                                       |
| the singleton check, one keel instance, a linked seam, versions in step (part 5)                                                                                                                                   | `sssb doctor`, run by the app's verify, and in the kit                                                                                                                                                                                                                                                                                                                                                                           |
| demo size (`scripts/check-demo-size.mjs`, `tests/tooling/check-demo-size.test.ts`)                                                                                                                                 | CLI: `sssb check-demo-size <bytes>`; the budget stays in the app's `package.json`                                                                                                                                                                                                                                                                                                                                                |
| Mantine CSS pruning (`scripts/vite-prune-mantine-css.ts` and its test)                                                                                                                                             | `@sssb/tools`, inside the Vite preset                                                                                                                                                                                                                                                                                                                                                                                            |
| static-demo bundle shape (`tests/tooling/static-demo-bundle.test.ts`)                                                                                                                                              | keel-repo-only: it pins how keel's modules are written                                                                                                                                                                                                                                                                                                                                                                           |
| scratch-dir hygiene (`tests/support/tmp-dir.ts`, `scripts/check-tmpdir-leak.mjs`, `keel/no-direct-mkdtemp`)                                                                                                        | `@sssb/tools` (the helper, importable by any workspace package, and the leak wrapper), preset (the rule)                                                                                                                                                                                                                                                                                                                         |
| doc paths (`tests/docs/doc-paths.test.ts`, `doc-set.test.ts`)                                                                                                                                                      | CLI: `sssb check-doc-paths`, configured by the adopter's own doc set, so an adopter keeps the gate the day `packages/keel` leaves the tree. The app guide keel ships is checked in keel's doc set against `apps/starter`                                                                                                                                                                                                         |
| ports, `.claude/launch.json`, `dev:real` preflight, standalone serve, e2e profile (`scripts/ports.mjs`, `print-port.mjs`, `write-launch-json.mjs`, `check-real-env.ts`, `serve-standalone.mjs`, `e2e-profile.mjs`) | CLI, and `ports` also as a JavaScript module, since Playwright configs and contract tests import `originFor` and `portFor`                                                                                                                                                                                                                                                                                                       |
| adopter identity (`tests/docs/adopter-identity.test.ts`)                                                                                                                                                           | dropped: `@sssb/create` writes the owner files from its flags once, and no later merge can bring keel's back                                                                                                                                                                                                                                                                                                                     |
| issue forms (`tests/docs/issue-forms.test.ts`)                                                                                                                                                                     | keel-repo-only                                                                                                                                                                                                                                                                                                                                                                                                                   |
| adoption probe (the `adoption-probe` CI job)                                                                                                                                                                       | replaced by pack and consume (part 7)                                                                                                                                                                                                                                                                                                                                                                                            |
| knip, jscpd, gitleaks, commitlint, lint-staged, Prettier, husky, `.nvmrc`                                                                                                                                          | config files `@sssb/create` writes once; they are the app's from then on                                                                                                                                                                                                                                                                                                                                                         |

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
green. `keel/no-raw-db-handle` was moved to its own id for exactly this reason. `sssb check-fences` (part 3)
probes the composed config to prove nothing was replaced.

**One plugin object.** Flat config throws `Cannot redefine plugin "keel"` when two blocks that match the same
file bind `keel` to different objects (`eslint.config.mjs` documents it). This repo's internal blocks and the
preset both bind `keel`, and `keel/public-surface` matches every file. So the published plugin object carries
every keel rule, internal ones included, the preset enables only the app-side ones, and this repo's config
imports that same object. Rule ids keep their names under the new prefix, `sssb/…`, which the rename step writes into every existing disable comment. Some internal
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

**`sssb doctor`.** It runs in the app's verify and checks:

- **one copy of each singleton**: for every peer keel declares, the real path of the package's directory, found
  from keel's directory, equals the one found from the app's. A peer that cannot be found from keel fails,
  rather than passing. Package directories, not entry points, because `@types/react` has no entry point to
  resolve. In the spike an entry-point version of the check reported one copy of each of `react`, `react-dom`,
  `next`, `next-intl` and `@mantine/core`, and against the `dependencies` mistake it printed `TWO COPIES  react`
  and exited 1. It is the `readlink -f` check build-notes tells a dependency PR to run by hand, made a command;
- **one SSSB per importer, with its own seam**: a package that takes `@sssb/core` without linking a seam does not fail. Under pnpm 11's default `dedupePeerDependents`, it silently shares another app's instance and runs on that app's seam. The independent review reproduced this with two apps and a seamless third package: under tsx and esbuild it printed the other app's service and migration, and `pnpm peers check` said nothing. The spike's Pages-shaped workspace did the same: the seamless package resolved to the second app's instance, seam included, and loaded it. With `dedupePeerDependents: false` and a clean install (removing the lockfile alone left the old layout in place), it got an instance of its own with no seam and failed loudly: `Cannot find package 'keel-app'`. So the check that protects is the layout, not a setting: for each importer of `@sssb/core`, doctor fails unless its own `package.json` declares the seam link and the instance it resolves has its seam pointing at that directory. Generated workspaces, and Pages' at the switch, also set `dedupePeerDependents: false`, and doctor reports it when missing, as advice only. pnpm does not record the setting in the lockfile (the spike's lockfile `settings:` hold only `autoInstallPeers` and `excludeLinksFromLockfile`), and setting it does not force a fresh resolution, so a lockfile resolved before it keeps the merged layout through every frozen install. The setting has a cost, too, by the second design review's reading of pnpm: it applies to the whole workspace, so a package with optional peers that two importers resolve differently gets a copy per importer, Vitest and ESLint plugins among them, which Pages runs from its root. In the spike's workspace, where the importers resolve their peers alike, `vitest` and `next` each kept one copy. Packages that only use `@sssb/tools` need neither. Inside this repo the seam goes through aliases, not a link, so doctor has an in-repo mode that checks the aliases instead;
- **versions in step**: every installed `@sssb/*` package is the same version as `@sssb/core` (failed, since the packages carry no dependency on each other that would keep them together); and, reported rather than failed, the commit SHAs the app pins for the reusable workflow and for the plugin's marketplace (in `.claude/settings.json`) against the release commit `@sssb/core` stamps into its package. Those two are reports because they are pins in the adopter's own files, not installed code, and CI and people not using Claude Code have no plugin.

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
  preset in `@sssb/tools`, as JavaScript.
- **Demo size** becomes `sssb check-demo-size <bytes>`, and the number stays in the app's `package.json`, as now.

### 7. CI

**Pack and consume, built first.** A job (and a local script) packs every package, installs the tarballs into a
workspace outside this repo, and runs that workspace's verify. Its first shape is the spike's Pages-shaped one,
built from a copy of `apps/starter`: the app under `apps/<slug>` with its own `src/adapters/real/` adapter,
`lint-exceptions.mjs`, a seam module that imports through the app's `@/` alias (as the showcase's `jobs.ts`
does), and an e2e spec that imports `@sssb/core/testing/e2e` and an app domain module; beside it, a second app with a different seam, a sibling package that imports keel and links the seam, one that uses only `@sssb/tools`, and, apart from them, one that imports keel with no seam link. The verify asserts that each app and package sees its own seam. The importer with no seam link is a separate negative fixture outside that verify: the job asserts that `sssb doctor` names it and that its own run fails loudly (part 5). Vitest and ESLint run from the
workspace root, as Pages runs them, not only per app. Once `@sssb/create` exists, a second shape is its
output. The verify covers typecheck with part 2's strict flags on, lint with `sssb check-fences`, unit tests plus
the kit, `sssb doctor`, `sssb check-e2e`, `next build` with `E2E_BUILD=1`, e2e (server and static demo), the
static demo's size, and the migrator's bundle with its assertions. Each workspace package depends on the
tarballs it uses directly (`"@sssb/core": "file:…/sssb-core-<version>.tgz"`). No overrides are used: pnpm 11 no longer
reads the `pnpm` field of `package.json` at all, and keel's packages do not depend on each other, so there is
nothing to override. The job fails if the lockfile resolves any `@sssb/*` package from a registry, so it can
never test an older published keel and go green. It is a required check on every PR.

What the spike found is the reason for the job: keel's tests reaching into the repo's `tests/`, `@types/pg`
declared only at the workspace root, transitive build-script approvals that only keel's `pnpm-workspace.yaml`
granted (pnpm 11 failed the consumer's install with `ERR_PNPM_IGNORED_BUILDS` for `@swc/core`), esbuild and tsx
missing the seam, and Node refusing keel's source. None of these can show inside the workspace.

**A reusable workflow, for orchestration only.** It is `on: workflow_call`, so it has no triggers: the caller
keeps its own (Pages: pushes to `main` and `integration`, and pull requests), its own concurrency group, its own
secret scan with its own `.gitleaks.toml`, and its own jobs beside keel's. It takes the app's directory as an
input. It brings the services (a `postgres:16` container for the contract job), the e2e shard matrix discovered
from the app's Playwright config, and the install. Every step's logic is a `pnpm exec sssb ci <job>` command,
so it comes from the app's lockfile and cannot drift from the installed packages. An optional `synth` job runs CDK synth in the app's `infra/` directory, or in the adopter's own infra directory, which is where the construct's assertions run (part 8). It takes no secrets, and callers must not pass `secrets: inherit`. It declares `permissions: contents: read`, and pins its own third-party actions by commit SHA and its service image by digest. Callers pin it by commit SHA, not by tag, because a tag can be moved. A private repository in
another organization can call a workflow in a public repository when that organization allows public reusable
workflows and the repository's Actions settings allow them; Pages' organization has to.

### 8. Infra

**Each app's deployment lives in the app** (JP, 2026-11-17, D8 below). Today the root `infra/` is the
showcase's deployment and nothing else: `infra/app.ts` imports `../apps/showcase/config/app` and
`../apps/showcase/config/params`, and `init-app` rewrites `infra/app.ts`, `infra/stack.ts` and
`infra/lib/tags.ts` on a rename or an eject. ADR-0007 and ADR-0012 put `infra/` in the repo scaffold, at the root.
Under this ADR the layout becomes:

```
packages/cdk/               @sssb/cdk: the SssbApp construct, check-shapes, the bundle and environment checks
apps/showcase/infra/        the showcase's deployment: app.ts, cdk.json, its own small package.json
apps/starter/infra/         the starter's, which @sssb/create ships with the template
```

The root `infra/` goes away. Nothing at the root names a specific app, so `init-app`'s rewriting of infra paths
goes too, one less source of merge friction while forks still exist. If accepted, ADR-0007 and ADR-0012 each get
an addendum recording it. The per-app folder is the template's default, not a rule: an adopter whose
infrastructure spans several apps keeps a root `infra/` that composes several `SssbApp` constructs with its
own. Pages does: its edge stack sits beside the console (part 11).

A **`SssbApp` construct**, not a `Stack` and not a CDK app, so that an adopter composes it inside their own
stacks: Pages has its own `PagesEdge` construct, an edge stack and separate CDK apps. Its props are the app's
directory and slug, the database transport (`pg` or `data-api`, #49's two network shapes) and the deployment
params, and it exposes the resources an adopter's own constructs need (the server function, its URL, the
distribution, the cluster). An app's `infra/app.ts` instantiates it with `..` as the app's directory and the
app's own `config/params`.

- **The migrator** is resolved **from the app's directory** (`keel/adapters/real/migrate-handler` as the app
  installed it) and bundled by esbuild. `@sssb/cdk` has no dependency on keel (rule 4), so an adopter's `infra`,
  often its own workspace package (Pages' is, and so is each `apps/<app>/infra`), never holds a keel instance of
  its own. The construct **always** passes the seam explicitly: `--alias:@sssb/app-config=<app>/src/app-config`.
  In a consumer that is redundant with the link; in this repo it is required, because there the fallback is the
  root tsconfig's fixture mapping. It asserts that the keel it found is its own version.
- **At synth the construct asserts** that the migrator bundle holds the app's own migrations, and that the
  server function's final environment has `APP_MODE: 'real'` and neither `DEMO_MODE` nor `E2E_BUILD`. The
  first is the check #54 put into `infra/check-shapes.ts`, which reads each Lambda's bundle out of the synthesized
  assembly; the second is the fail-closed guard `production-guard.test.ts` checks today by reading
  `infra/stack.ts`, which no adopter's infra is. That test moves to the construct. `@sssb/tools` exports both
  checks as functions over a synthesized assembly, so an adopter whose infra does not use the construct (Pages,
  at the switch) still runs them.
- #49's `infra/check-shapes.ts`, which synthesizes both network shapes and, since #54, reads their bundles,
  becomes the package's own test, and each app's synth runs the construct's assertions for that app.

**What per-app infra costs**, all in the step that moves it (P9):

- `pnpm-workspace.yaml` lists `apps/*/infra` instead of `infra`;
- the lint, knip and Vitest globs treat `apps/*/infra` as a CDK project, not app source. Globs written `apps/*/**` (the vendor ban's file list, for one) would otherwise apply
  the app's rules to it;
- `cdk.out` is ignored per app;
- CI's synth step, #54's synth gate and `check-shapes` run once per app, and the reusable workflow's optional
  `synth` job takes the app's directory.

### 9. Agent assets

- **A Claude Code plugin**, from a marketplace in this repo, carrying the commands an app author runs
  (`/new-slice`, `/new-entity`, `/new-job` and the other capability scaffolds, `/verify`, `/pre-pr`) and the
  `doc-steward` agent. The maintainer commands stay in this repo: `/new-port` writes a keel port into
  `packages/keel`, which in an adopter's repo is `node_modules`. Commands address the app through its declared
  root (below), not `apps/<app>/…` and not a bare `src/…`, which is wrong from the root of a workspace like
  Pages'. A plugin installs per user from its marketplace, not from the app's lockfile, so the repository pins the marketplace to a commit SHA in `.claude/settings.json`, as the workflow is pinned: a plugin runs on developers' machines, with more reach than CI. `sssb doctor` reports when that pin and the installed keel disagree.
- **`CLAUDE.md` splits in two.** The rules an app author follows (the seam, vendor SDKs, `getDb`, i18n,
  router-agnostic screens, hermetic dev) ship as a markdown file inside `@sssb/core`. `sssb guide` copies it into the adopter's repository, with a hash of its content stamped in a header line, and the adopter's own `CLAUDE.md` imports that copy with Claude Code's `@path` import. The trust decision: agent instructions steer every agent working in the repo, so a change to them arrives as a reviewable diff in the adopter's own PR, never silently through `node_modules`. `sssb doctor` fails when the stamped hash differs from the installed guide's, so an upgrade is not finished until the copy is refreshed and the change sits in the adopter's diff. The hash, not the bytes, is compared, so the adopter's formatter cannot make the copy look stale. The maintainer half (two apps, the fixture, the fence internals) stays in this repo's `CLAUDE.md`.
- **The app is named where it is used.** Every `sssb` command acts on the app in its current directory, or the
  one an `--app` flag names, so each package's own scripts work as they are, and this repo's two apps each run
  their own. An `sssb.apps` list in the workspace's `package.json` is only the default for whatever fans out
  across apps: a workspace-wide `sssb` run, the plugin's commands and the reusable workflow's input. A workspace
  like Pages', where the app is not at the root, is first-class.

### 10. Releases

- **Changesets, with every package in one fixed group:** one version number for the set, and a generated
  changelog.
- **0.x semantics as npm reads them.** `^0.3.0` accepts only `0.3.x`, so a **minor** is the breaking channel and
  a patch must be compatible. Changesets turns a `major` changeset on 0.x into 1.0.0, so a breaking change is
  filed as `minor`. Because SSSB's packages carry no dependency on each other (rule 4), no release bumps a
  package by way of another's peer range, which is how a peer-dependent bump could otherwise lift the whole
  fixed group to 1.0.0. As a backstop, since npm versions cannot be withdrawn, CI fails when the computed
  release plan (`changeset status`) contains any version of 1.0.0 or higher.
- **Breaking means:**
    - a seam change (a new required export in an `app-config` module, the kind `docs/adopting.md`'s "When an
      update changes what your seam must say" lists);
    - an `exports` removal;
    - a framework migration that needs operator action;
    - a raised peer floor;
    - a preset rule, kit check, `sssb doctor` check or tsconfig-base option that turns existing app code red;
    - a new required environment variable (`REQUIRED_ENV`), secret or IAM permission;
    - a `@sssb/cdk` change that replaces a stateful resource. A changed logical id replaces the Aurora cluster on
      the next `cdk deploy`. CI snapshots the logical ids of stateful resources and the `REQUIRED_ENV` list, and a
      change to either requires a `minor` changeset.
- **Every changelog entry has a "Seam changes" section and a "Framework migrations" section**, empty or not.
  They replace the merge-time discovery ADR-0013 relied on. Two more sections join them: "Operator actions" (the cutover rows a release adds or changes), and "Scaffold changes to apply by hand", because files the generator writes once (the gitleaks rules, the CI caller) never update on their own.
- **Cadence: on demand, at most weekly while 0.x.** Releases are cut from `main`. A fix ships in the next release: a patch when nothing breaking is pending on `main`, otherwise the next minor. Nothing is backported (D7).
- **The two-consumer rule gates every release:** both apps green and pack and consume green on the release
  commit.
- **Publishing uses the registry's trusted publishing from GitHub Actions (OIDC), with provenance**, so no long-lived registry token is stored. The precedent and template is CanopyCMS's release workflow (`safeinsights/canopycms`, `.github/workflows/publish.yml`), whose packages `safeinsights-bot` owns and GitHub Actions publishes. Its shape:
    - a `release-commit` job, on each push to `main`, waits for CI to pass on that merge commit, then versions with Changesets and tags the release. Its release-bot key sits in an environment that only `main` may use;
    - a `publish` job, on the tag, is the only one holding `id-token: write`. It publishes each package with `--provenance` through a pinned npm 11.19, because, as the workflow notes, OIDC trusted publishing needs npm 11.5.0 or later;
    - npm allows one trusted publisher per package, bound to a workflow filename, so every publish, prereleases included, enters through that one file. Prereleases go out under their own dist-tag (CanopyCMS's is `int`);
    - a publish is never cancelled part-way, so a set of packages is never left at mixed versions.
- **Release candidates** ship as tarballs attached to a GitHub prerelease of `safeinsights/sssb`, installed by URL as each workspace package's direct dependency. A release asset can be replaced under the same URL, and only the adopter's lockfile pins its integrity. So the notes list each tarball's sha512, the attach step runs only on a tag and attests the artifacts, and the guide says to commit the lockfile and install with `--frozen-lockfile`. A regenerated lockfile fetches the tarballs again, so their sha512s are checked again then. The prerelease notes carry
  the same "Seam changes" and "Framework migrations" sections, written by hand until Changesets exists.

### 11. Pages' migration from fork to dependency

The measurement in the Context is the reason this can be early and cheap: Pages has never edited
`packages/keel`. The steps are for exactly Pages' layout, and the spike's last consumer had that shape. Every
reference they edit came from a sweep of Pages' `integration` branch for files outside the ones step 2 deletes
that name something step 2 deletes.

1. **No catch-up merge.** Pages holds its keel merges and takes everything since 24b0589 (#32) through the switch: among it #34's `authorize()` seam changes, #46 and #49's Data API transport, #51's lint exceptions, #52, #53, #54 and the rename to SSSB. The release candidate's notes, whose "Seam changes" and "Framework migrations" cover everything since 24b0589, are its list of seam edits, and `tsc` points at each
   one. Until the switch, Pages' migrator has the bug #54 fixed in keel (step 7).
2. **Delete what keel now ships:**

    - `packages/keel`, and keel's spike: `spikes/kysely-pglite`, its `spikes/*` entry in `pnpm-workspace.yaml`
      and the CI step that tests it;
    - keel's `scripts/` (`init-app.ts`, `check-demo-size.mjs`, `ports.mjs`, `print-port.mjs`,
      `write-launch-json.mjs`, `check-real-env.ts`, `serve-standalone.mjs`, `e2e-profile.mjs`,
      `check-tmpdir-leak.mjs`, `vite-prune-mantine-css.ts`). Pages' own `infra/scripts/` stays;
    - keel's own gates in `tests/` (`tests/lint`, `tests/tooling`, `tests/docs`, `tests/support`), and
      `tests/vitest.setup.ts`, which the Vitest preset now carries. Pages' own
      `tests/lint/pages-maintainer-db.test.ts` goes with its harness (`tests/lint/lint-text.ts`), because
      `sssb check-fences` now probes each `lint-exceptions.mjs` entry;
    - keel's docs (ADRs, recipes, runbooks, doctrine), served by keel by version; keel's maintainer commands in
      `.claude/commands` (`/new-port` writes into `packages/keel`) and keel's `.claude/future-tasks`, keeping
      Pages' own;
    - the `.gitleaks.toml` allowlist entry for keel's `packages/keel/src/service-auth/webhook.test.ts`.

    Until the plugin step (P13), Pages' app-author commands and `doc-steward` stay as forked copies that cite
    `packages/keel`. Its coverage numbers change when keel's tests leave the run.

    **Keep every file `@sssb/create` would write for an adopter**, even where Pages' copy is identical to
    keel's: `.husky/`, `commitlint.config.mjs`, `lint-staged.config.mjs`, `.prettierrc.json`, `.prettierignore`,
    `.editorconfig`, `.nvmrc`, `.gitleaks.toml`, `.jscpd.json`, `knip.json`, the issue templates and owner files.
    Those are the adopter's from now on.

3. **Install the release candidate**, by tarball URL, as direct dependencies, and drop the root's and
   `apps/console`'s `"keel": "workspace:*"`. Check each tarball against the sha512 in the release notes, and
   again whenever the lockfile is regenerated, since that fetches the tarballs anew; commit the lockfile, so CI's
   `--frozen-lockfile` install pins them.

    - `apps/console`: `@sssb/core`, `@sssb/tools`, `@sssb/eslint-plugin`, and the seam link
      `"@sssb/app-config": "link:./src/app-config"`, with `apps/console/src/app-config/package.json`;
    - the root: `@sssb/tools`, because the root Vitest configs and scripts use it;
    - `packages/cli`: `@sssb/tools`, for its tests' temp directories. It takes no keel and links no seam.
      `infra` takes `@sssb/tools` for the assembly checks, and `@sssb/cdk` once it adopts the construct;
      neither brings keel. Any package that does import keel itself also links the seam (part 5);
    - the root `package.json`: `packageManager` and `engines` for pnpm 11, and `sssb.apps: ["apps/console"]`;
    - `pnpm-workspace.yaml`: the `allowBuilds` entries keel's dependencies need, and
      `dedupePeerDependents: false`, then one clean install (no lockfile and no `node_modules`), because pnpm
      re-resolves under the setting only from scratch (part 5).

4. **Config and imports, per package.**

    - `apps/console/eslint.config.mjs` is the app preset plus Pages' own blocks. `apps/console/lint-exceptions.mjs`
      lists `src/domain/pages/maintainer-db.ts` with its reason, replacing the exception in the root config.
    - `apps/console/tsconfig.json` extends the base (it includes `../../packages/keel/src` today).
      `next.config.ts` (it points next-intl at `../../packages/keel/src/i18n/request.ts`) and
      `vite.demo.config.ts` (it aliases `keel` to `packages/keel`) use the presets. The app's Vitest project uses
      its preset, which brings the kit with it (part 3).
    - `apps/console/package.json`'s `dev` and `start` scripts take their port from `sssb port` instead of
      `../../scripts/print-port.mjs`, and `check:demo-size` runs `sssb check-demo-size 843000`.
    - `apps/console/playwright.config.ts` imports `originFor`, and both contract tests import `portFor`, from
      `@sssb/tools`' ports module instead of `../../scripts/ports.mjs`.
    - The nine tests that import `makeTestTmpDir` or `makeTestTmpDirAsync` from `tests/support/tmp-dir` take them
      from `@sssb/tools`: five in `apps/console/src/domain/pages/*.db.test.ts`, the two contract tests, and
      `packages/cli`'s `cli.test.ts` and `credentials-file.test.ts`.
    - The root `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `vitest.contract.config.ts`, `knip.json`
      and `.jscpd.json` lose their entries for `packages/keel`, its test fixture and `spikes/`, and keep Pages'
      own workspace: `apps/console`, `packages/gate`, `packages/cli`, `infra`.
    - Comments in Pages' code that cite keel's paths (`apps/console/src/adapters/real/storage.ts`,
      `src/app-config/messages.ts`, `config/params.ts`) now name files in keel's repo, not Pages'. No gate reads
      code comments; reword them when convenient.

5. **Root scripts, and the scripts CI runs.** `init-app` goes; `pages` and `dev:edge` stay. `prepare` calls
   `sssb launch-json` instead of `scripts/write-launch-json.mjs`, and `test:unit`, `test:coverage` and
   `test:contract` run through `@sssb/tools`' leak wrapper instead of `scripts/check-tmpdir-leak.mjs`. Pages' CI
   runs `lint`, `typecheck`, `test:coverage`, `knip` and `jscpd`, never `verify` (only its adoption probe did,
   and that goes), so the new gates go into scripts CI runs: `lint` adds `sssb check-fences` and
   `sssb check-doc-paths`, and `test:coverage` and `test:unit` add `sssb doctor` and `sssb check-e2e`. `verify`
   keeps fanning out over the whole workspace.
6. **CI.** `checks.yml` keeps its triggers, its concurrency group and its gitleaks job. The `adoption-probe` job and the keel spike's step go. Every other job Pages runs is then seen green after the switch: `lint-typecheck-unit` (`lint`, `typecheck`, `test:coverage`, `knip`, `jscpd`, `pnpm --filter infra synth`), `contract` (`test:contract`), the e2e shards, `demo-static` (`build:demo-static`, `check:demo-size`, `e2e:demo-static`) and `secret-scan`. Its other jobs keep running Pages' scripts until the reusable workflow exists,
   and then call it for keel's jobs beside Pages' own.
7. **Infra stays Pages', with two edits.** Pages keeps its layout: a root `infra/` that composes its edge stack beside the console is exactly the multi-app case part 8 keeps open, and the per-app `apps/<app>/infra/` is only the template's default. Its `infra/` is already its own composition (`PagesEdge`, the edge stack, the conformance scripts, separate CDK apps).
    - Its keel-derived `infra/stack.ts` bundles the migrator from
      `../packages/keel/src/adapters/real/migrate-handler.ts` with the root tsconfig, and Pages' root tsconfig
      maps `@app-config/*` to keel's test fixture, so today Pages' migrator ships the fixture's three `dockets`
      migrations and none of the console's. The entry is re-pointed at the keel `apps/console` installed, with the
      seam alias.
    - Its infra tests run both of `@sssb/tools`' assembly checks: the migrator bundle holds the console's
      migrations, and the server's environment is fail-closed. That replaces `production-guard.test.ts`, which
      read `infra/stack.ts` and leaves with `packages/keel`.

    It moves the stack onto the `SssbApp` construct when that lands.

8. **Agent rules and the rest of the 18.** Pages' `CLAUDE.md` is keel's text, citing `packages/keel`,
   `scripts/` and `tests/support`, and `sssb check-doc-paths` reads it. At the switch it keeps Pages' own rules
   and imports keel's app guide, which ships in the release candidate. The other 17 files Pages edited on purpose (the Context's split) stay Pages': its CI, its configs' entries for `gate`, `cli` and `infra` (moved into its own blocks beside the presets), its `pages` script, its gitleaks entry, its `README.md`, `LICENSE` and owner details. So do files keel never had: its cutover checklist's own rows and `docs/keel-readme.md`. The 47 that `init-app` wrote are deleted or replaced in steps 2 and 4.
9. **Then:** `pnpm install`, `pnpm verify`, the contract tests and `pnpm --filter infra synth`.

**A script?** Not a shipped one: there is one adopter. Two one-off inventories drive the steps above, and both
are worth re-running in Pages at the switch: the classification behind the Context's counts (identical, an older
keel version, `init-app` output or Pages' own, by blob), and the sweep for references to what step 2 deletes.

### 12. Decisions for JP

JP decided all seven on 2026-11-17, and added D8 to D10 the same day. They are recorded under "Decisions JP made" below.

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
   one merge per file the adopter edited. `@sssb/create` writes the files that must stay app-owned config
   once, and they rarely change.
5. **Option A or option B for the seam**, and **compiled from day one** (parts 1 and 2).

## Consequences

- An adopter's repository is their app, their own packages and thin config. An upgrade is `pnpm up` and reading
  the changelog's "Seam changes". There are no merges: a fix arrives in the next release, with `pnpm up`.
- Every adopter installs every vendor SDK the framework lists (`@clerk/nextjs`, the `@aws-sdk` clients, `@anthropic-ai/sdk`, `@sentry/nextjs`, `mailgun.js`, `pg`, `posthog-node`), used or not.
- keel pays ADR-0013's predicted cost (semver judgement, a changelog, deprecation windows), now that there is a
  consumer to pay it for.
- keel can no longer quietly depend on its own workspace: tests importing the repo's `tests/`, `@types` declared
  at the root, a root tsconfig deciding the seam, scaffold handing keel's source to Node. Pack and consume makes
  each of those red on the PR that introduces it.
- ADR-0012's seam keeps its shape, and its specifier is renamed (an addendum, if this is accepted).
- **The npm names have a single owner.** The `sssb` organization and every package belong to the `safeinsights-bot` npm account alone, because JP has no personal npm account; CanopyCMS's packages are set up the same way and published from GitHub Actions. If that account were lost, no one could publish or administer the names. Adding a second, human owner is an account action, for as soon as a maintainer has an npm account.
- An adopter cannot edit keel in place. ADR-0013 already said a keel change must never be carried locally, and
  `pnpm patch` is the emergency valve while the fix goes upstream.
- Retired when `@sssb/create` ships: `init-app`, the adoption probe and the adopter-identity test. The fork
  sections of `docs/adopting.md` are rewritten around the generator, and ADR-0013 becomes Superseded once Pages
  has switched. The doc gate's rule for reference-app citations in merged-in docs then serves only this repo.

## Decisions JP made (2026-11-17)

These were the ADR's open decisions. JP Slavinsky decided all seven on 2026-11-17, and the same day added D8 to D10 and revised D3, in a chat with the keel manager session, which relayed them here. D2's name was reopened afterwards (the Decision section). `docs/decision-log.md` records them under the same date.

- **D1 — Registry: public npm.** keel's repo is public and MIT, and GitHub Packages' npm registry requires an
  access token, a classic personal access token, to install even a public package, so every adopter's machine
  and CI would have needed one. Pages still switches on release-candidate tarballs (D5), before anything is
  published.
- **D2 — Name: keel is renamed SSSB, and every package is scoped under `@sssb`.** Checked read-only on
  2026-11-17: `keel` on npm is teamkeel's backend framework (version 0.505.0, published that day), and
  `create-keel-app` and `keeljs` are taken too. The first choice, strake, was dropped the same day, and JP chose
  SSSB, deliberately leaving the letters undefined (the Decision section has the record and the checks). The
  naming rule: every package is under the `@sssb` organization. The framework is `@sssb/core`, imported directly
  as `@sssb/core/…` (JP chose that over an `npm:` alias that would give it a shorter name); the generator is
  `@sssb/create`, which `npm create @sssb` runs; then `@sssb/tools`, whose CLI is `sssb`; `@sssb/eslint-plugin`;
  `@sssb/cdk`, with the `SssbApp` construct; and the seam, `@sssb/app-config`, only ever a local link and never
  published. The rule first made the framework and the generator unscoped (`sssb` and `create-sssb`), and npm
  refused to publish `sssb` as too similar to existing packages (the Decision section). With every name in the
  scope, owning the scope reserves them all, and no name outside it needs defending. The seam has to be scoped
  in any case (part 1: an unscoped name could install a stranger's package). A 404 for a package does not show
  who owns its scope: the registry answers `/-/org/<org>/package` for an organization that exists, packages or
  not, which is how strake was found taken. Inside this repo the apps depend on `"@sssb/core": "workspace:*"`,
  and the new repository is `safeinsights/sssb`. History keeps saying keel (the Decision section).
- **D3 — Licence and copyright: MIT, copyright assigned to Rice University** (revised the same day). JP transfers keel's copyright to SafeInsights, that is Rice University, and the `LICENSE` line becomes "Copyright (c) 2026 Rice University", MIT unchanged. The changed line records an assignment JP makes; the assignment itself is JP's to execute, and the line changes only once it is done, before the first release candidate's tarballs carry it. Pages' `LICENSE`, which today reads "Copyright (c) 2026-present Rice University" above keel's line, then needs only Rice's.
- **D4 — The showcase stays** in this repo as the reference app, the public demo and the first of the two
  consumers. It is never published. `@sssb/create` has no eject: its template is `apps/starter`, copied
  when the generator is packed, so the template is always the app the two-consumer rule tests.
- **D5 — Pages switches at the first release candidate (P7)**, on prerelease tarballs.
- **D6 — Release age.** Pages' install (inherited from keel's `pnpm-workspace.yaml`) refuses versions published
  less than two days ago (`minimumReleaseAge: 2880`), which would hold an SSSB fix back two days. SSSB's own
  packages are exempted from it, since this repo's CI gates their releases.
- **D7 — No backports during 0.x.** Fixes go into the next release from `main`, and an adopter on an older minor upgrades. Revisit when there is a second external adopter.
- **D8 — Per-app infra.** Each app's deployment lives in the app (`apps/<app>/infra/`), the reusable code in `@sssb/cdk`, and the root `infra/` goes away, so nothing at the root names an app. The starter gets one too, so `@sssb/create` ships a deployable starting point. An adopter whose infrastructure spans several apps keeps its own root `infra/` (part 8). This one was not among the ADR's open questions; JP added it the same day.
- **D9 — Stewardship: maintained by SafeInsights, not SafeInsights-specific.** The universality test is the guard (the Decision section), and the rename PR states it in `README.md`, `CONTRIBUTING.md` and `docs/README.md`.
- **D10 — A new home: `safeinsights/sssb`.** `jpslav/keel` is archived after a pointer commit, and the project continues in a new repository holding a copy of the full git history, so every commit and author is kept. The rename is its first PR. Doctrine docs qualify old PR references, and the dated records get an appended entry naming the repository their numbers refer to (the Decision section). The npm organization was created by the `safeinsights-bot` npm account, its sole owner for now, and trusted publishing names the new repository.

**JP's account actions**, which the plan depends on, in order. Reservation comes first, before this PR merges,
because the PR is public and names the packages:

| Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | When                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Step zero (P0): reserve the names, by owning the scope.** The npm organization `sssb` was created on 2026-11-17 by the `safeinsights-bot` npm account, its sole owner for now; it is confirmed with `npm org ls sssb`, because a package name's 404 does not show who owns its scope. Every package is under that scope, so nobody else can publish any of them. Placeholders, never the seam, give P14 a package to configure: the organization's package list names `@sssb/core`, `@sssb/create`, `@sssb/tools`, `@sssb/eslint-plugin` and `@sssb/cdk` | done on 2026-11-17, before this PR named the packages publicly                                                                                                                                                                                                                                   |
| Land the in-flight `jpslav/keel` PRs before the copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | done: #59 and #62 (P11) have landed. A PR opened in `jpslav/keel` after this ADR merges either lands before the copy or is reopened in the new repository                                                                                                                                        |
| Create `safeinsights/sssb` with a copy of `jpslav/keel`'s full history, and set it up: CI, branch protection, secrets                                                                                                                                                                                                                                                                                                                                                                                                                                      | after those PRs land, and before P1. JP's action, or done with JP's explicit go                                                                                                                                                                                                                  |
| Execute the copyright assignment to Rice University (D3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | before P7, whose tarballs carry the `LICENSE` line. P1 changes the line if the assignment is done by then; otherwise a small PR before P7 does                                                                                                                                                   |
| Archive `jpslav/keel` after a last commit that points its README at `safeinsights/sssb`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after P1 merges                                                                                                                                                                                                                                                                                  |
| Add a second, human owner to the `sssb` organization and to every package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | when a maintainer (JP or another) has a personal npm account. Until then `safeinsights-bot` is the single owner: a known risk (Consequences)                                                                                                                                                     |
| Configure a trusted publisher on each package, naming `safeinsights/sssb` and its release workflow, then set each package to disallow tokens                                                                                                                                                                                                                                                                                                                                                                                                               | at P14, once that workflow exists: npm's trusted publisher names the repository and the workflow file, and GitHub's token carries the repository's name, so it cannot be set up earlier. It is configured per package, so the package must already exist, which step zero's placeholders provide |

## Implementation plan

Each step is one PR and leaves both apps green, because each moves the in-repo apps onto the new piece in the
same PR, and from P2 on pack and consume proves the piece the way an adopter gets it. D1 to D10 are decided and P0 is done, so no step waits on a decision or a reservation. **P0 was JP's: owning the `@sssb` scope reserves every name.** Every step from P1 on is a PR in `safeinsights/sssb`, opened through the si-bob relay and approved
and merged by `jpslav`.

| Step | PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Depends on                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| P0   | **Reserve the names** by owning the `@sssb` scope (JP's account actions, above). Done on 2026-11-17. No code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | D2                               |
| P1   | **Move and rename: the first PR in `safeinsights/sssb`.** By codemod, then a grep for every old token (CLAUDE.md's rule for renames): `packages/keel` becomes `packages/core`, the package `@sssb/core` (the apps: `"@sssb/core": "workspace:*"`); imports `keel/…` become `@sssb/core/…` in source, tests, `vi.mock` and `import()` specifiers, tsconfig `paths` and the Vitest and Vite aliases, so keel's own `core` module, 16 of the 132 subpaths, reads `@sssb/core/core/…`; the seam `@app-config/*` becomes `@sssb/app-config/*`, an optional peer, with the lint fence and its tests; the lint rule ids `keel/…` become `sssb/…`, disable comments included; `init-app`, the doctrine docs, `CLAUDE.md`, the commands and the `doc-steward` agent. It also puts the stewardship sentence (D9) in `README.md`, `CONTRIBUTING.md` and `docs/README.md`, qualifies the doctrine docs' PR references (`jpslav/keel#54`), appends an entry to each dated record saying its earlier numbers refer to `jpslav/keel`, and changes the `LICENSE` line if the assignment is done (D3). Dated records and ADRs 0001–0013 keep keel. | P0, the new repository           |
| P2   | **Pack and consume.** The job and a local script: pack the framework, build the adopter-shaped workspace of part 7 from copies of `apps/starter` outside the repo, and run its verify (typecheck at part 2's floor and strict flags, unit tests, the framework's five seam-conformance suites run from the tarball, `next build`, e2e, the static demo, the migrator bundle), plus the negative fixture. It lands green by naming today's gaps as workarounds, each tied to the step that removes it: for example `@types/pg` added by the consumer (P3), the copied prune plugin, `ports.mjs`, `print-port.mjs` and `check-demo-size.mjs` (P4), the next-intl request path written into `node_modules` (P4), and the skipped `demo-presets-seam` suite (P3).                                                                                                                                                                                                                                                                                                                                                                     | P1                               |
| P3   | **Package hygiene.** A `files` allowlist that still ships the five seam-conformance suites until P5 replaces them; the framework compiling under part 2's strict flags and floor; `@types/react`, `typescript` and `kysely` as peers, the other `@types` as dependencies; the helpers 23 of the framework's tests import from the repo's `tests/support`, moved into the package. `private` stays until P14.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P2                               |
| P4   | **`@sssb/tools`**, as JavaScript, with no dependency on `@sssb/core`: the `sssb` CLI (demo size, ports, launch config, `dev:real` preflight through esbuild, standalone serve, e2e profile, the temp-dir leak wrapper, `check-doc-paths`, `guide`, `ci <job>`), the helpers any workspace package may import (`makeTestTmpDir`, the ports module, the two assembly checks), the Next, Vite and Vitest presets, and the tsconfig base. Every resolver in it resolves `@sssb/core` from the app's directory and runs rule 4's shared check. Both apps switch; `scripts/` keeps only what is the repo's own. It comes before P5 and P6, whose checks are `sssb` commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P1, P3                           |
| P5   | **The conformance kit at `@sssb/core/testing`** (the mutation scan per app root with app-owned exemptions and their staleness check, i18n partition and parity, the pglite RLS runner, the owner pass, the Data API suite and its emulator, migration order, demo presets, the seam-map check, the cutover rows as data, the seam-free `@sssb/core/testing/e2e`), **`sssb doctor`** and **`sssb check-e2e`** (with an in-repo mode, since here the framework's files are under `packages/`). The Vitest preset adds the kit's entry point to `include` by absolute path, with named opt-outs; `sssb doctor` checks that statically, and the entry fails a skipped check that has no opt-out. Both apps take it through the preset, instead of `vitest.config.ts` listing the framework's test files, and the showcase's specs move onto `@sssb/core/testing/e2e`; the `files` allowlist then drops the framework's tests.                                                                                                                                                                                                         | P1, P4                           |
| P6   | **`@sssb/eslint-plugin`**, as JavaScript, with no dependency on `@sssb/core`: one plugin object with every rule, every app-side fence under its own rule id, repo anchors as rule options, `configs.app({ root })`, and `sssb check-fences`, which also probes each `lint-exceptions.mjs` entry. This repo's config imports the same object. Pack and consume lints from the workspace root and from the app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P1, P4                           |
| P7   | **The first release candidate.** On a tag only, pack and consume attaches its tarballs to a GitHub prerelease of `safeinsights/sssb` and attests them. The notes list each tarball's sha512, the install lines for each workspace package, and hand-written "Seam changes", "Framework migrations", "Operator actions" and "Scaffold changes to apply by hand" sections covering everything since 24b0589, the rename among them. The app guide (the app-facing half of `CLAUDE.md`) ships inside `@sssb/core` from here, checked by the doc gate against `apps/starter`. **This is the first step that lets Pages switch**: it needs no registry, no generator, no CDK construct and no reusable workflow.                                                                                                                                                                                                                                                                                                                                                                                                                       | P5, P6, the copyright assignment |
| P8   | **Pages switches** (in `safeinsights/pages`, part 11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P7                               |
| P9   | **`@sssb/cdk` and per-app infra (D8)**, as JavaScript, with no dependency on `@sssb/core`: the `SssbApp` construct (both transports) in `packages/cdk`, the migrator resolved from the app with the explicit seam alias, the synth assertions (the app's migrations, the fail-closed environment, the app's `@sssb/core` at the construct's own version), `check-shapes` as its test, and the production-guard test moved onto it. The root `infra/` becomes `apps/showcase/infra/` and the starter gains `apps/starter/infra/`, each instantiating `SssbApp` with its own directory and params; `init-app` stops rewriting infra paths. Its costs (part 8): `apps/*/infra` in `pnpm-workspace.yaml`, the lint, knip and Vitest globs, `cdk.out` ignored per app, and CI's synth, #54's gate and `check-shapes` run per app. Pages adopts the construct when it chooses, in its own root `infra/`.                                                                                                                                                                                                                                | P1, P4                           |
| P10  | **The reusable workflow** (orchestration only, no secrets, `contents: read`, the apps input, an optional `synth` job that takes the app's infra directory), called by this repo's own CI for both apps, pinned by SHA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P4, P5, P6, P9                   |
| P11  | **The starter's own contract project and database, and its own `params.ts`**, so the generator's template carries the gates `init-app` used to copy from the showcase. Done: #62, in `jpslav/keel`, before the copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                                |
| P12  | **`@sssb/create`**: the starter template, its `infra/` included, plus generated config (presets, the seam link and its `type`, `allowBuilds`, `dedupePeerDependents: false`, `sssb.apps`, a workflow calling the reusable one, the owner files from flags). Pack and consume gains its second shape. `init-app`, the adoption probe and the adopter-identity test are retired in the same PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P4–P6, P9–P11                    |
| P13  | **The Claude Code plugin** (the app-author commands; the maintainer ones stay), and this repo's `CLAUDE.md` cut to the maintainer half, importing the app guide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P12                              |
| P14  | **Releases to public npm, from CI, modeled on CanopyCMS's `publish.yml`** (part 10): a `release-commit` job on pushes to `main` (CI must pass on the merge commit; Changesets versions and tags; a `main`-only release environment), and a `publish` job on the tag, alone holding `id-token: write`, publishing with provenance through npm 11.5.0 or later. Changesets in a fixed group, with `major` changesets and any release plan reaching 1.0.0 rejected on 0.x; the logical-id and `REQUIRED_ENV` snapshots; the trusted publisher configured on each existing package for that one workflow file (JP's account actions); then 0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P0, P10                          |
| P15  | **ADR-0013 Superseded** and `docs/adopting.md` rewritten around the generator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P8, P12                          |

**Pages' critical path is P0, the new repository, P1, P2, P3, P4, then P5 and P6, P7, P8**, with the copyright
assignment before P7. It is a single line: P1 and P3 both edit most of the framework's files, and P4, P5 and P6
all touch the root `package.json`, the lockfile and `knip.json`. P9 and P10 run beside it. P11 has landed (#62).
