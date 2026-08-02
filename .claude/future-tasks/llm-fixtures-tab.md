# LLM / fixtures tab

**Priority:** P2 · **Status:** open

A Simulator tab showing which fixture answered the assistant (purpose, fixture file, matched entry),
listing available fixtures, and linking the `pnpm llm:record` workflow. First concrete step toward the
intended eval harness (`docs/development-approach.md`, eval harness 🧭). Pairs with an `llm` port surface
for "list recorded conversations".

The fixtures themselves went conversation-shaped in the LLM-tools slice — entries now carry a
`conversation` of recorded model turns, not just a single `response` — so this tab has real per-turn
detail (including which tool was called) to show once it's built. The tab itself is still unbuilt.
