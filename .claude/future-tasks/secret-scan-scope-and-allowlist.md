# The secret scan reads every branch, and its one allowlist entry exempts a whole file

**Priority:** P1 · **Status:** open
**Found by:** an app derived from this template, which hit both defects and fixed them in its own copy,
2026-10-03. Both re-checked here against `.github/workflows/checks.yml`'s `secret-scan` job,
`.gitleaks.toml`, and the pinned gitleaks 8.30.1.

Two separate defects in the same gate. The first fails closed and is a nuisance; the second fails
open and is a hole.

## 1. Every open PR scans every other open branch

The `secret-scan` job checks out with `fetch-depth: 0` and runs `./gitleaks git --redact --config
.gitleaks.toml` with no `--log-opts`. With no `--log-opts`, gitleaks 8.30.1 builds its history walk as
`git log -p -U0 --full-history --all` (`sources/git.go`, `NewGitLogCmdContext`). `--all` means every
ref in the clone, and a `fetch-depth: 0` checkout fetches every branch on the remote.

So the scan on PR A also reads branch B. One branch that commits a secret-like string turns the
`secret-scan` check red on **every** open PR until that branch is fixed or deleted. Each PR author sees
a finding in a file their PR never touched. The derived app hit this more than once when several branches
were open at the same time, and one worker came close to allowlisting another branch's finding just to
get its own PR green. That is the worst outcome: the allowlist entry would have outlived the branch.

### Shape of the fix

Scan the PR's own commits on `pull_request`, and keep the full-history guarantee on `push` to `main`:

- `pull_request`: `--log-opts="${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}"`.
  This is the PR's own commits, including any it added and then deleted. That deleted case is what
  the `fetch-depth: 0` comment is protecting.
- `push` to `main`: scan `main`'s full history (`--log-opts="HEAD"`), never `--all`. Whatever reaches
  `main` is still scanned in full.

The derived app put this in a small script that picks the range from the event, which keeps the
workflow step readable. Watch out for quoting: gitleaks splits `--log-opts` on spaces and warns about
quoted values (gitleaks issue 1153).

## 2. `paths` + `regexes` in one allowlist entry means _either_, not _both_

`.gitleaks.toml`'s only `[[allowlists]]` entry sets `paths` (the webhook test file) and `regexes` (the
placeholder secret, `regexTarget = "line"`). Its comment says the entry is "Scoped to that one file
AND that one string". That is false. In gitleaks 8.25 and later, an allowlist with several criteria
uses `condition = "OR"` by default (the gitleaks README, under `[[rules.allowlists]]`). So the entry
suppresses:

- **every finding in that file**, whatever the string, and
- **every line anywhere in the repo that contains the placeholder**, whatever else is on that line.

Measured with gitleaks 8.30.1 against the shipped `.gitleaks.toml`, in a throwaway repo with three
planted findings:

| Planted finding                                                       | Shipped config (`OR`) | With `condition = "AND"` |
| --------------------------------------------------------------------- | --------------------- | ------------------------ |
| A cloud access key, in the allowlisted test file                      | **missed**            | caught                   |
| A live payment-API key on the same line as the placeholder, elsewhere | **missed**            | caught                   |
| The same cloud access key, in an unrelated file                       | caught                | caught                   |

With `condition = "AND"`, a full-history scan of this repo still finds nothing, so the real fixture
stays allowlisted.

### Shape of the fix

- Add `condition = "AND"` to the entry and make the comment say what the config actually does.
  Another option is to drop `paths` and keep only the regex. That is narrower than the shipped
  config, but it still allows the placeholder in any file.
- Leave a note beside the entry that `OR` is gitleaks' default. Adopters copy this file, and the
  next entry someone adds will be shaped like this one.
- **See the gate fail before trusting it** (CLAUDE.md's rule). Plant a finding in the allowlisted
  file and watch the scan go red, then plant one on a line that contains the placeholder in another
  file and watch it go red too. Remove both and watch it go green.

## Not in scope

Gitleaks' built-in stopwords silently skip some obviously fake tokens. That is a different behavior
with its own workaround (build test secrets that avoid the stopword list). It is not this config's
defect.
