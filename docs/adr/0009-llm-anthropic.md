# ADR-0009 — LLM: Anthropic behind a port, pinned models

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

An LLM is an external service like any other, so it belongs behind a port (`docs/development-approach.md`).
It also has two properties the other vendors do not, and both of them are decisions.

**It is non-deterministic.** A demo walkthrough or an E2E assertion that depends on generated prose is a
flaky test with better prose. Whatever the fake is, it has to be reproducible.

**Its output is attacker-influenced.** Anything the model reads — a stored record, an inbound email — can
carry instructions aimed at the model rather than the user. That is not a hypothetical for a multi-tenant
app whose content is written by its users.

## Decision

**An `llm` port** (`packages/keel/src/ports/llm.ts`) with three methods: `complete`, `stream`, and
`runToolLoop`. The tool loop is the shape that needed a decision: the app supplies tool definitions, an
initial message list, and an `execute` closure; the adapter drives the model↔tool alternation and returns
the full turn sequence. **The port never executes a tool itself** — it carries the model's `tool_use`
request out and the app's `tool_result` back in. Both adapters refuse to dispatch a `tool_use` whose name
is not among the supplied definitions.

**Model ids are pinned in exactly one module** — `packages/keel/src/core/llm-models.ts`, holding
`LLM_MODELS.default` and `LLM_MODELS.fast` — and appear nowhere else. A model upgrade is a one-line
change plus fixture re-recording.

**The fake adapter replays versioned fixture files deterministically.** A fixture entry pairs a `request`
with either a single-turn `response` or a `conversation` — the recorded assistant turns, including
`tool_use` requests. Replay drives those turns while `execute` always runs **live** against the fake
world, so a tool's result is never canned: the demo's assistant really reads the demo's rows. That split
is what keeps the fake honest rather than merely convenient.

`pnpm llm:record` (re-)records fixtures from the real API and is exercised once an API key is available
(cutover row `llm-key`). Hand-authored fixtures must follow the exact recorded format so that re-recording
is a drop-in replacement and the diff is reviewable.

### The trust model is written down in the port

`packages/keel/src/ports/llm.ts` carries a TRUST MODEL comment above `LlmToolLoopRequest`, and it is
required reading before adding a second tool. In short: tool results are **user content** flowing into
the model's context; model output is therefore **always untrusted** — display it, never branch on it,
never wire it to a privileged action; and a tool's blast radius is exactly its `execute` closure, so
scope that closure to the caller's session, capture resolved ids at build time rather than accepting
model-supplied ones, and validate every field of model-controlled input.

Tool `description` and `inputSchema` are **model-facing prompt content**, not user-facing UI copy. They
are plain strings and deliberately do not go through next-intl (ADR-0008), because translating a prompt
changes the model's behavior rather than the reader's experience.

## Consequences

- Demo walkthroughs and E2E runs are fully deterministic, including the tool-calling ones.
- Model upgrades are a one-line change in one file, plus a fixture re-record whose diff is the review.
- The fixtures are also the on-ramp to an eval harness: an entry already pairs an input with expected
  model behavior, which is the dataset shape a harness would read (`docs/development-approach.md`).
- Adding a tool is a security review, not a feature. The port makes the blast radius nameable — it is one
  closure — which is the whole reason the loop lives here rather than in app code.
