# Run the adoption probe outside `/tmp` on macOS

**Was:** P3 · **Status:** RESOLVED — **not** a repo defect. Kept because the false alarm cost hours, and
because the next person to hit it will otherwise spend them again.

`docs/adopting.md`'s acceptance test is "copy the repo somewhere, run `pnpm init-app --eject-showcase`,
then `pnpm install && pnpm verify` in the copy." **Do not put that copy under `/tmp` (or
`/private/tmp`) on macOS.**

## What happens if you do

`pnpm test:e2e` fails deterministically with, from `packages/keel/src/adapters/fake/auth.ts`:

```
Error: `cookies` was called outside a request scope.
```

9 of 10 `auth-flows` tests fail, and the run takes ~9 minutes instead of ~35 seconds.

## Why it is not a repo bug

`/tmp` is a symlink to `/private/tmp`. Next resolves modules under both spellings of the path, so the
request handler and the fake auth adapter end up holding **different instances of `next/headers`** — and
`cookies()` reads an AsyncLocalStorage context that belongs to the other instance. Nothing about the
repo causes it; any Next app with a workspace package would do the same.

Ruled out along the way, each by direct test: the adoption changes themselves (an unmodified clone
reproduces it), a stale `.next` (a cold worktree passes in 35s), the Node version (fails identically on
the pinned 24.18.0 and on 24.12.0), and duplicate `next` copies (same `.pnpm` hash).

**Proof:** a fresh `git clone` of `main` under `/tmp` fails 9/10; the identical clone under `~/dev`
passes 10/10 in 36s. Linux CI is unaffected — no such symlink.

## What to do

Probe under `~/` or any real path. If you see this error anywhere else, check for two copies of `next`
in the module graph before suspecting the auth adapter — the message names the symptom, not the cause.
