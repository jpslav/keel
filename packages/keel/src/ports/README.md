# packages/keel/src/ports

Narrow interfaces the app codes against — sized to what the app needs, never to a vendor's API.
Arrives with the ports-and-adapters phase: `auth`, `db`, `storage`, `llm`, `email`, `analytics`, `jobs`.

Machine-to-machine callers (service tokens, inbound webhooks) are verified by `packages/keel/src/service-auth/`,
a sibling seam beside the `auth` port, not a port itself — it checks app-owned signatures over
app-owned state, not a vendor SDK. See ADR-0003 and `docs/decision-log.md`.
