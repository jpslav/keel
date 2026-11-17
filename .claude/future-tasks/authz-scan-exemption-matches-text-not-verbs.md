# The authorization scan's exemptions match text in a file, not the guard on each verb

**Priority:** P1 · **Status:** open
**Found by:** the review of `fix/audit-clock-and-cron-route` (2026-11-17), which gave the starter a `webhooks/cron`
route that rests on this exemption. The gap is older than that change and the scan file is unchanged by it.

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
