---
description: Re-record LLM fixtures from the real Anthropic API and review the diff
---

Run `pnpm llm:record` (requires `ANTHROPIC_API_KEY`; see cutover row `llm-key` if unset). Then
`git diff apps/showcase/fixtures/llm/` and summarize what changed for me — fixture changes alter demo walkthroughs
and e2e assertions, so list any test that asserts on the old text. Use `--all` only if I asked for a
full re-record.
