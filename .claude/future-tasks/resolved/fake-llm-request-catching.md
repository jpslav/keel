# Fake LLM adapter should catch every request it's sent

**Priority:** P2 · **Status:** RESOLVED 2026-10-03

The fake email adapter catches every message it's asked to send into `.data/emails/`, which is how a
Simulator tab or a test inspects what was actually sent without a real mail provider. The fake LLM
adapter (`packages/keel/src/adapters/fake/llm.ts`) has no equivalent: nothing records what a request
actually asked the model to do, only the fixture lookup's canned answer.

**Need:** the fake LLM adapter should catch every request it's sent (purpose, system prompt, messages,
timestamp) before resolving it against the fixture, the same catch-point pattern the fake email
adapter already uses, with simulated-only accessors to list and clear the catch. A fixture proves what
an app does with an answer; a request catch proves what the app put into the prompt in the first
place — the two are complementary, and today only the first exists.

Evidence: `packages/keel/src/adapters/fake/llm.ts` (today's fixture-only lookup, no catch),
`packages/keel/src/adapters/fake/simulator-admin.ts` (`LIVE_DIRS`, the world-reset/snapshot mechanism
any new catch directory would need to join so a reset clears it and a snapshot carries it, the same
way the mailbox already does).

## Resolution

The fake LLM writes every request to `.data/llm-requests/` before its fixture lookup, so a request with
no fixture is still caught. Each catch records the purpose, system prompt, messages and timestamp, and
for `runToolLoop` the tool definitions (name, description, input schema; never the `execute` closure).
`listCaughtLlmRequests(purpose?)` (oldest first) and `clearCaughtLlmRequests()` are simulated-only
exports, not on `LlmPort`. The directory is in `LIVE_DIRS`, so a world reset clears it and a snapshot
carries it.

One limit: `stream` is an async generator, so its catch lands on first iteration, and a stream nobody
consumes is never caught.

Nothing reads the catch yet outside tests. A Simulator view of it would sit naturally beside
`llm-fixtures-tab.md`.
