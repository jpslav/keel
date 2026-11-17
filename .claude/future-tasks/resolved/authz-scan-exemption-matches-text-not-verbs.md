# The authorization scan's exemptions match text in a file, not the guard on each verb

**Priority:** P1 · **Status:** RESOLVED 2026-11-17 — `fix/authz-scan-per-verb`, ADR-0012 addendum of that date
**Found by:** the review of `fix/audit-clock-and-cron-route` (2026-11-17), which gave the starter a `webhooks/cron`
route that rests on this exemption. The gap is older than that change and the scan file is unchanged by it.

## Resolution — the scan reads each handler with the TypeScript parser

`packages/keel/src/authz/route-scan.ts` parses and binds each route file with the TypeScript compiler (one file at
a time, no import resolution; the 80 route files here in about 150 ms), finds every exported mutating handler in every form
Next accepts, and judges each on its own path. `authorized-mutations.test.ts` keeps the policy: the roots, the
exemption map and the gates. The fix went wider than this file asked, because the main rule had the same flaw:

| Shape, dropped into `apps/starter/src/app/api` and run through main's scan  | main's scan | now  |
| --------------------------------------------------------------------------- | ----------- | ---- |
| `webhooks/`: the real route (`export const POST = withWebhookSecret(…)`)    | pass        | pass |
| `webhooks/`: `'withWebhookSecret('` in a string, an open `POST`             | pass        | fail |
| `webhooks/`: a guarded `POST` and an unguarded `DELETE`                     | pass        | fail |
| `webhooks/`: the guard's name only in a comment                             | fail        | fail |
| `'authorize('` in a string, an open `POST`                                  | pass        | fail |
| an authorized `POST` and an open `DELETE`                                   | pass        | fail |
| `authorize(...)` under `if (false)`                                         | pass        | fail |
| `authorize(...)` after `return`                                             | pass        | fail |
| `authorize(...)` in a closure the handler never calls                       | pass        | fail |
| `authorize(...)` only in the `GET`, an open `POST`                          | pass        | fail |
| `service/`: `'withServiceCaller('` in a string, `authorize` called          | pass        | fail |
| `service/`: a wrapped `POST` and an unwrapped `PATCH`                       | pass        | fail |
| `simulator/`: the `if (!isSimulated)` gate on `POST` only, an open `DELETE` | pass        | fail |
| `simulator/`: the gate's text only in a string                              | pass        | fail |
| `webhooks/`: a local look-alike of the guard wraps an open `POST`           | pass        | fail |
| `simulator/`: `isSimulated` is a local constant                             | pass        | fail |
| `simulator/`: the real-mode branch mutates before its 404                   | pass        | fail |

Each row is a case in `authorized-mutations.test.ts` ("the shapes the text-matching scan passed now fail"), judged
against the real policy. The last three came from the review of this change.

What this file asked for, and what was built:

- **Strings and comments.** Not stripped with a tokenizer: the scan never reads text. A call is a call expression
  in the syntax tree, so a string or comment cannot be one.
- **Per verb.** Every exemption's `mustMatch` is now a structured gate checked on each exempted handler, and its
  kind says what "guarded" means for that entry: `wrapped-by` (the handler IS the guard's call; `webhooks/`, and
  `service/`'s required `withServiceCaller`), `calls` (the handler reaches the port call), or
  `opens-with-simulated-404` (the handler's first statement is the `if (!isSimulated)` gate, and its branch only
  returns or throws a response built from literals). Every name in a gate must be a value import kept under its
  exported name, so a local look-alike or an alias is not the gate.
- **The `simulator/` worry.** A per-verb rule there fails nothing: each of the 19 mutating simulator handlers (18 in
  the showcase, 1 in the fixture) opens with its own gate, and the two files that export a second verb (`flags`,
  `snapshots`) gate their `GET` separately as well. So the rule is per verb everywhere, and no entry is per file.
- **Fixture.** The gated routes import their stand-ins from `packages/keel/test-fixture/api/stand-ins.ts`; each had
  defined its own locally, which is the look-alike the scan now refuses. `webhooks/jobs/route.ts` and
  `service/jobs/route.ts` called their wrapper inside a function handler; they now have the apps' shape,
  `export const POST = withX(…)`. `dockets/[id]/route.ts` is new: two mutating verbs in one file, one authorizing
  through a same-file helper.

No app route was a false green. Every route that passed still passes, with the same verbs judged.

The original finding follows, unchanged.

## What is true

`packages/keel/src/authz/authorized-mutations.test.ts` exempts a mutating route from `authorize(...)` when its path
matches an entry in the exemption map (`webhooks/` is a prefix entry) AND the route file's source contains that entry's
`mustMatch` (for `webhooks/`: `/with(?:WebhookSecret|MailgunSignature)\s*\(/`). Two properties of how it checks make the
exemption weaker than its reason:

1. **Strings are not stripped, only comments** (`stripComments`, `authorized-mutations.test.ts:103`). The guard's name
   inside a string literal satisfies the match.
2. **The match is once per file, not once per exported verb** (the check at `:323` runs `mustMatch` on the whole file).
   A guarded `POST` beside an unguarded `DELETE` passes.

## Reproduced

On a scratch copy, replacing `apps/starter/src/app/api/webhooks/cron/route.ts`, each time running the scan
(`vitest run packages/keel/src/authz/authorized-mutations.test.ts`):

| Route file                                                                                     | Result                   |
| ---------------------------------------------------------------------------------------------- | ------------------------ |
| the real route (`export const POST = withWebhookSecret(…)`)                                    | 73 passed                |
| `const why = 'withWebhookSecret('` and an open `export const POST = async () => …`             | 73 passed, a false green |
| a guarded `POST` and `export async function DELETE() { return Response.json({ open: true }) }` | 73 passed, a false green |
| the guard's name only in a `//` comment, an open `POST`                                        | fails, as it should      |

The second row is not an attack, just a route someone extends: the unguarded verb is exactly the mistake the scan exists to
catch, and an exemption by prefix is the case where nothing else will.

## Shape of the fix, and what it must not break

- Strip string and template literals as well as comments before matching, with a tokenizer and not a regex (the existing
  `//`-inside-a-string trap is documented beside `stripComments`).
- For an exemption whose reason is a guard WRAPPING a handler (`webhooks/`, `service/`), require each exported mutating
  verb to be that guarded expression, for example `export const (POST|PUT|PATCH|DELETE) = with…(`.
- Do NOT make that rule universal: the `simulator/` exemption rests on a gate inside the handler
  (`if (!isSimulated) return 404`), and some routes export several verbs behind one gate, so a per-verb rule there would
  fail routes that are fine. Decide per exemption what "guarded" means, and say it in the entry.
- Each new rule needs a fixture file that demonstrates it (the staleness checks are measured against
  `packages/keel/test-fixture/api`), and a negative case watched failing: the three rows above are the cases.

## What done looks like

The two false greens above fail, the real tree and the fixture stay green, and the exemption map says per entry whether
its gate is per file or per verb.
