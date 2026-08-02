# ADR-0011 — Email: Mailgun, react-email, and the port as the catch-point

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Email is the one integration where the usual local-development answer — run a catcher, point SMTP at it —
does not fit this scaffold. The real transport is a provider's **HTTP API**, not SMTP, so an SMTP catcher
would be catching mail that production never sends that way: a different code path, exercised only
locally, which is exactly the divergence the hermetic rule exists to prevent. It would also need a
process running, breaking the no-docker rule.

If the transport is HTTP, the natural catch-point is the port itself.

## Decision

**An `email` port with `send`, and Mailgun as the real adapter.** Templates are authored as react-email
components (`packages/keel/src/email/templates/`); the rendered HTML is what goes to the provider in
production, and the same components render in Ladle for authoring.

**The fake adapter stores every rendered message** under `.data/emails/` (in memory in the browser
fakes), and the Simulator's Mail tab reads that store: a per-person inbox plus an "all mail" view. There
is no dev-only mailbox route and no SMTP catcher. Playwright asserts email flows against the same store,
so an E2E test and a human demo are looking at the same thing.

Domain and API key are cutover items (`email-outbound`); until that row closes the real adapter carries an
`AUTHORED — CUTOVER` header and is typechecked but never run.

### Inbound is intake machinery, not a port method

The capability runs both directions, and the asymmetry between them is deliberate.

**Why there is no `receive()` on the port.** A port is the seam the app calls **out** through. The app
never calls "receive email" — the world initiates it, arriving as an HTTP webhook. So the seam for
inbound is a **webhook route plus a handler registry** (`packages/keel/src/inbound-email/`, shaped like
the jobs handler registry), which is the same shape as every other inbound counterparty in the scaffold.
Adding a `receive()` method would have been a method nothing ever calls, and would have made the port
mean "email-related things" rather than "how the app sends mail".

**Verification.** The provider signs inbound routes as `HMAC-SHA256(signingKey, timestamp + token)`,
a different concatenation from the `{timestamp}.{body}` scheme the outbound webhook signer uses — a good
illustration of why the pure HMAC lives in `packages/keel/src/core/webhook-signing.ts` (cross-checked
against `node:crypto`) while the key lookup and replay guard live in
`packages/keel/src/service-auth/mailgun.ts`, beside the bearer verifier.

**Address scheme.** `<org-slug>+<handler>@<domain>` — plus/sub-addressing, one domain, one catch-all
route. The recipient resolves the org and therefore the tenant. A real multi-domain instance would resolve
the tenant from the domain first, and the code says so where it matters.

**Failure behavior, because it is the part that bites.** Intake files the message durably **before**
running the handler. A handler that throws yields a `failed` status, a kept row, and a **200** to the
provider — a provider retries a non-2xx for hours, so a permanently broken message returned as a 5xx
retries forever. Genuine infrastructure failures (the row insert itself throwing) do propagate as a 500,
because those a retry can fix. An unresolvable recipient is recorded as `unmatched`.

**The fake.** The Simulator's Mail tab can compose an inbound message — the world emails the app — and it
calls the **same intake function directly** rather than spoofing a signature. Faking the signature would
have made the fake a test of the verifier instead of a test of the intake.

**Deliverability** (bounce and complaint events) is the near-universal next handler and is deliberately
not built: a real instance routes those events to the same webhook seam. It is recorded in the
`email-inbound` cutover row rather than half-implemented.

## Consequences

- Email is visible and testable offline, including inside the `file://` static demo, because the catch
  point is the port rather than a process.
- The provider domain and keys are cutover items; until then the real adapter is authored but unverified,
  and labelled as such in its own header.
- Inbound and outbound share a vendor and share nothing else — one is a port method, one is a route plus a
  registry — which is the general rule for any integration that runs both ways.
- No new vendor SDK was added for inbound; the HMAC is implemented here and cross-checked against
  `node:crypto`.
