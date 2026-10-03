# keel — a multi-tenant application template

A production-shaped Next.js foundation you fork and build a product on: ports-and-adapters architecture,
Postgres row-level-security tenancy, and a local development loop that runs the whole world on your laptop
with no docker, no credentials, and no network.

```sh
pnpm install
pnpm dev
```

That is the entire setup. The app boots in seconds against fake adapters — in-process Postgres, a person
picker instead of a hosted IdP, caught email in a dev mailbox, deterministic canned model replies — with
two seeded tenants and six people already in the world. **Fresh clone to running app in under two minutes
is this repo's standing acceptance test**, not an aspiration.

Prerequisites: Node ≥ 24 (`.nvmrc` pins it), pnpm ≥ 11, and — once, before `pnpm verify` —
`pnpm exec playwright install chromium`.

## Two things here are unusual

Ports and adapters with fakes behind them is table stakes; the pattern is twenty years old and you have
seen it. These two are the reason this repo exists.

### 1. The world around the app is simulated, inhabited, and drivable

A fake stubs what your app calls **out** to. That leaves a world that stands still: nothing calls back in,
so an async workflow sits at `queued` with nobody to advance it, and the only way to watch your app behave
like production is to go get production.

Here the fakes compose into a world with inhabitants, and a panel called **Simulator** to drive it:

- **Other people**, each with their own inbox and their own last-known location. Click one and you are
  them, restored to where they were — including people who were invited but never signed up, whose mail
  you can read before they have an account.
- **Counterparties that act on their own.** Simulated external services run as independent processes and
  talk to your app only over the surfaces a real one would — genuine HTTP polls and signed webhooks, never
  an in-process shortcut. Pause one, or step it a single call at a time.
- **A clock you can push forward.** Jump an hour, a day, a week, and watch the scheduled work that came
  due actually fire.
- **A world you can snapshot and restore**, plus demo presets that load the same starting point in the
  static demo too, so a demo starts from the same state every time.
- **Walkthroughs that drive themselves.** A _tour_ is the temporal sibling of a snapshot: it restores one
  (or a demo preset), then drives the real screens with a ghost cursor while a bar narrates. Nothing is submitted until the
  person watching presses Next, and every registered tour is run to its last step in CI, so a screen change
  that breaks the story fails the build instead of embarrassing you in front of a stakeholder.

You can hold every job in the world at `queued` and watch the choreography, then let them complete inline
again. None of this reaches production: real builds ship zero Simulator client code.

### 2. The boundaries are enforced by the build, not by documentation

Every architectural rule here is a check that fails, because a rule that lives only in a document is a rule
that erodes on the first busy Friday:

| Rule                                            | What stops you                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Vendor SDKs only inside adapters                | lint (`no-restricted-imports`)                                                |
| No untenanted database access in a request path | lint bans raw `getDb()`                                                       |
| Every mutating route authorizes                 | a build-time scan walks the routes and fails any that don't                   |
| Tenant isolation actually isolates              | one RLS proof suite, run against both the in-process engine and real Postgres |
| The framework never reaches into your app       | a package fence — one registration seam is the only door                      |
| No hard-coded UI strings                        | lint, plus a test that both locale catalogs stay key-identical                |
| Docs don't lie about paths                      | a test fails if a doctrine doc cites a path that doesn't exist                |
| Dead code                                       | `knip` fails the build                                                        |

One command runs all of it: `pnpm verify`.

## Why "keel"

A keel is the structural member laid down first, that the whole hull is built onto and nobody ever sees
again. That is the job of `packages/keel`: tenancy, authorization, the ports, the migrations, the screens
you would otherwise write twice. You import it; you don't edit it.

It is deliberately **not** named after the simulated world. Simulator is that world's panel, and keeping
the two words apart is the point — the framework is much broader than the world it simulates.

## Modes and scripts

| Command                  | What it is                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `pnpm init-app`          | Adopt: rename the app you keep, eject the demo (`--dry-run` to preview)             |
| `pnpm dev`               | Hermetic dev: all fake adapters, seeded, offline                                    |
| `pnpm dev:real`          | Real adapters against cloud resources — fails fast, listing missing cutover items   |
| `pnpm verify`            | The gate: typecheck + lint + unit + e2e + static-demo build + `file://` walkthrough |
| `pnpm test:contract`     | The same RLS proofs on **real Postgres**, for the app and for keel's own fixture    |
| `pnpm build:demo`        | Demo build (fake adapters, demo badge); `pnpm start:demo` serves it                 |
| `pnpm build:demo-static` | Single-file demo (`dist-demo/index.html`) that runs from `file://`                  |
| `pnpm ladle`             | Component workshop (screens + email templates)                                      |

That last build deserves a note. `dist-demo/index.html` is **one HTML file with no server** — the same
screens over in-memory fakes, Simulator included. You can email it to someone and they can click through
the whole product from disk, or press **Simulator → Tours → Start** and be walked through it. It is also the most demanding proof that the ports boundary really holds: if
anything reached past a port, it could not build.

**Demoing it.** Two clicks get you into the story, on `pnpm dev` and in the single-file demo alike.
**Simulator → Snapshots → Start from a preset → Load** resets the world to a scripted starting point and
signs you in as the right person; **Simulator → Tours → Start** hands the wheel to a narrated walkthrough,
which may itself begin from a preset. [docs/runbooks/demo.md](docs/runbooks/demo.md) is the story to tell;
`/new-preset` and `/new-tour` are how you write your own.

## Architecture in one paragraph

Vendor SDKs live only in [packages/keel/src/adapters/](packages/keel/src/adapters/) (lint-enforced);
everything else codes against the narrow interfaces in [packages/keel/src/ports/](packages/keel/src/ports/)
(`auth`, `db`, `storage`, `llm`, `email`, `analytics`, `jobs`). Domain logic is pure TypeScript in
[packages/keel/src/core/](packages/keel/src/core/). Screens are router-agnostic — which is what makes the
`file://` demo possible — and route files are thin wrappers. Tenancy is enforced _in the database_ by
row-level security: every tenant-scoped query runs inside `withTenant()`. Inside a tenant, `authorize()` is
the single choke point for resource-level decisions. All UI copy flows through next-intl (`en` + `es`).

## Using it as a template

Read **[docs/adopting.md](docs/adopting.md)**. The short version: the framework is `packages/keel`, your
app extends it only through the `apps/<app>/src/app-config/` registration seam, and a capability you don't
want is turned off by registering nothing for it.

```sh
pnpm init-app acme --name "Acme Research" --eject-showcase
```

That renames the app you keep, deletes the demo, and repoints every file that named either — the whole
mechanical half of adoption. Two example apps ship here: `apps/showcase` (a support desk — tickets, escalations, file
attachments, an export job run by a simulated external service) so every framework capability has a living
worked example, and `apps/starter`, the minimum you keep. Build against the showcase as your reference,
eject it when you no longer read it.

Updates from upstream arrive by `git merge`, not `pnpm update` — see
[ADR-0013](docs/adr/0013-upstream-updates-fork-and-merge.md). There is deliberately **no changelog**:
the framework is not versioned, so what a merge brings you is the merge's own diff.

## What this is not, and what to expect

**It is not a library.** You do not add it to an existing app; you start from it. It hands you the verify
gate, the lint fences, the CI workflows and the docs doctrine along with the code, and `pnpm add` cannot
deliver any of that. [ADR-0013](docs/adr/0013-upstream-updates-fork-and-merge.md) explains why it stays
that way, and what would change the answer.

**It is opinionated on purpose.** One component library, one data layer, one way to do tenancy. The
decisions are written down in `docs/adr/` with their reasoning, and treated as settled for routine work.
New information reopens one; taste does not.

**Some of it is authored but unverified.** Every adapter that needs a real credential — auth, email,
LLM, object storage, analytics — is typechecked against its vendor SDK and has never spoken to the real
service. Those carry an `AUTHORED — CUTOVER` header and a row in
[docs/cutover-checklist.md](docs/cutover-checklist.md) naming the exact proof each one owes. The template
is honest about this rather than quietly hoping; the fakes are what you actually develop against.

**Support posture.** Maintained in spare time. Issues and PRs are welcome — especially improvements to
the framework half from someone who has adopted it, since that is the only way a second consumer ever
checks the seam. Expect a straight answer, not a fast one.

## Where things are

- `packages/keel/` — **the framework**: ports, adapters, core, db/RLS, authz, i18n, the Simulator harness
  and the generic screens (ADR-0012)
- `apps/` — one directory per app, each self-contained (its own `package.json`, configs, e2e and contract
  tests); single-app root commands delegate to `apps/showcase` until you eject it (ADR-0007)
- `apps/<app>/src/` — **an app**: routes (`apps/<app>/src/app`), the registration seam
  (`apps/<app>/src/app-config`), domain modules, product cards, the static demo twin
- [docs/README.md](docs/README.md) — the map of the doc set: binding doctrine (path-gated), dated records,
  and `.claude/future-tasks/`
- [docs/development-approach.md](docs/development-approach.md) — the engineering philosophy, and why
- `docs/adr/` — the architecture decisions, all Accepted; the design is decided, not aspirational
- `docs/cutover-checklist.md` — every deferred item that needs real credentials, and the proof each owes
- [CONTRIBUTING.md](CONTRIBUTING.md) — conventions, how to add an adapter, commit format

## License

MIT — see [LICENSE](LICENSE). Take it, build a product on it, keep the product yours. If you improve the
framework half, a PR back is appreciated but not owed.
