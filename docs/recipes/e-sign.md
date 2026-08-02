# Recipe: formal e-signature (Zoho Sign / DocuSign)

keel ships the **access-gate** class (`packages/keel/src/core/gates.ts`) with **clickwrap agreements**
as the worked example: a gate is a condition an actor must satisfy before proceeding, with a scope, a behavior
(block/advisory), and a **resolution flow**. Clickwrap resolves the gate _in-app_ — the user reads the terms
and clicks Accept, and an append-only `agreement_acceptances` row clears it.

**Formal e-signature is the same gate class with an _externally-resolved_ resolution flow.** Instead of
an in-app button, clearing the gate requires a signing ceremony performed by a third-party vendor
(Zoho Sign, DocuSign, Adobe Sign), which reports completion back asynchronously. Nothing here is built;
this page is the deliverable (the round-2 doctrine: known patterns get written down, not built early —
see `docs/development-approach.md` and the sms-twilio / web-push recipes this one copies).

Crucially, **this needs no new integration class.** After signed outbound webhooks and the
inbound-webhook seam, the template already teaches every mechanic a signing vendor needs:
outbound API call → inbound verified webhook → state machine → signed artifact. E-sign is those exact
pieces wired to a new logo. Building it into the template would demonstrate an existing class twice.

## The shape: an externally-resolved gate

```
 in-app gate pending ─▶ user starts ceremony ─▶ OUTBOUND call to vendor (create envelope)
        ▲                                                   │
        │                                                   ▼
        │                                       vendor hosts the signing ceremony
        │                                                   │
        └──── gate clears when signed ◀── INBOUND webhook (verified) ── vendor: "completed"
                        │
                        ▼
             signed PDF pulled to storage (the signed ARTIFACT)
```

Every arrow is an existing seam:

- **Outbound "create envelope"** — a plain authenticated `fetch` to the vendor, the shape
  `packages/keel/src/server-lib/*` real-mode branches already use (email, sms). Not even the
  signed-egress machinery is needed for the _request_; that machinery is the model for the
  _inbound_ verification.
- **Inbound "envelope completed" webhook** — verified exactly like the Mailgun inbound signature
  (`packages/keel/src/service-auth/mailgun.ts`) or the job webhook
  (`packages/keel/src/service-auth/webhook.ts`): an HMAC or vendor-signature check at
  `POST /api/webhooks/esign`, 404/401 fail-closed, first line.
- **State machine** — the envelope's lifecycle (`created → sent → viewed → signed | declined | voided`)
  is the `packages/keel/src/core/state-machine.ts` pattern the jobs and escalations lifecycles
  already use. Illegal hops 409; terminal transitions are idempotent (vendors retry — the
  redelivery lesson).
- **Signed artifact** — the completed PDF is pulled into storage through the existing `storage` port
  and recorded as an `attachments` row, so a signed document is a first-class, downloadable
  artifact with tenant isolation, exactly like an export.

## 1. The gate wiring is already there — extend the seam, don't fork it

`packages/keel/src/core/gates.ts` is domain-agnostic on purpose. A signature requirement is a new
**fact** and a new gate, registered the same way `gatesForAgreements` registers agreement gates:

```ts
// packages/keel/src/core/gates.ts — GateFacts already an open bag; add the rider's key:
export interface GateFacts {
    pendingAgreementIds?: string[]
    pendingSignatureIds?: string[] // NEW: envelope ids awaiting this actor's signature
}
```

```ts
// packages/keel/src/core/e-sign.ts (NEW, pure) — the rider, shaped exactly like
// packages/keel/src/core/agreements.ts
export interface SignatureRequirement {
    id: string
    envelopeId: string | null // null until the ceremony is created with the vendor
    title: string
    status: 'pending' | 'sent' | 'signed' | 'declined'
}

export function gatesForSignatures(reqs: SignatureRequirement[]): Gate[] {
    return reqs.map((r) => ({
        id: `signature:${r.id}`,
        scope: 'all',
        behavior: 'block',
        // Unlike clickwrap (resolved IN the layout), e-sign resolves on its OWN route: the ceremony
        // launcher. This is exactly why Gate.resolutionPath exists (see the gates.ts seam note).
        resolutionPath: '/sign',
        pending: (facts) => (facts.pendingSignatureIds ?? []).includes(r.envelopeId ?? r.id),
    }))
}
```

The protected layout's gate hook (`apps/showcase/src/app/[locale]/(protected)/layout.tsx`) assembles the facts and
calls `evaluateGates` **once** over ALL registered gates — agreement gates and signature gates side by
side. A blocking signature gate renders an interstitial whose resolution content is a **"Start
signing" launcher** (not an Accept button) that navigates to `resolutionPath`. This is the one place
e-sign differs from clickwrap: the resolution flow is a redirect to a vendor-hosted ceremony, not an
in-place acceptance.

## 2. Sketch the vendor seam (a port, because it wraps an SDK)

Unlike agreements (port-less, app-owned state), e-sign wraps a vendor, so it earns a port under the CLAUDE.md
rule (vendor SDKs only in `packages/keel/src/adapters/`). Sketch only — do not build:

```ts
// packages/keel/src/ports/esign.ts (SKETCH)
export interface CreateEnvelopeInput {
    documentPdf: Uint8Array // or a storage key the vendor pulls
    signerEmail: string
    signerName: string
    subject: string
    /** Our correlation id — echoed back on the webhook so we can resolve the tenant/gate. */
    metadata: { requirementId: string; tenantId: string }
}
export interface EnvelopeHandle {
    envelopeId: string
    /** The vendor-hosted ceremony URL the launcher redirects the signer to. */
    ceremonyUrl: string
}
export interface EsignPort {
    createEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeHandle>
    /** Pull the completed signed PDF (called from the webhook handler after `signed`). */
    fetchSignedDocument(envelopeId: string): Promise<Uint8Array>
}
```

- **Fake** (`packages/keel/src/adapters/fake/esign.ts`): a Simulator counterparty, the
  outbound-webhook/actors precedent. It records the "envelope", exposes a **"sign as counterparty"** button in a
  Simulator tab (or a Snapshots control), and on click calls the SAME inbound webhook intake the real
  vendor would — so the demo drives the real resolution path, never a spoofed state write (the
  inbound-email honesty rule). The fake `fetchSignedDocument` returns a generated placeholder
  PDF so the signed artifact is always real and downloadable (the "no dead download link"
  invariant).
- **Real** (`packages/keel/src/adapters/real/esign.ts`): the ONLY file allowed to `import
'@zoho/…'` / the DocuSign SDK. Fail-closed with `CutoverPendingError` until its cutover row is
  filled, like every real adapter.

## 3. Persistence (tenant RLS per `1001_tickets`)

- `signature_requirements` (tenant-scoped; who must sign what — the gate's backing rows), carrying the
  `envelopeId`, `status`, and `artifactId` once signed.
- The signing lifecycle transitions are **append-only history** (the `agreement_acceptances` /
  `audit_events` privilege pattern: SELECT/INSERT only) so a completed signature can never be silently
  rewritten. The signed PDF is an ordinary `attachments` row — no new storage machinery.

Agreements are TENANT-level; signature requirements are typically **per-user** (each signer signs their
own copy), so `signature_requirements` carries a `user_id` (opaque, the jobs/notifications convention),
not just a tenant. Decide org vs tenant scope per the instance's document (a company-wide NDA is
tenant-level; a per-project SOW is org-level) — the same scoping decision `0013_agreements` recorded.

## 4. Cutover rows

Add a `zohoSign` (or `docusign`) block to `apps/showcase/config/params.ts`, following the existing shape (plain
values for non-secret identifiers, `*Name` for the _name_ of a secret — never a secret value):

```ts
zohoSign: {
    accountId: 'PLACEHOLDER_ZOHO_SIGN_ACCOUNT_ID', // non-secret identifier
    baseUrl: 'PLACEHOLDER_ZOHO_SIGN_BASE_URL', // region endpoint, e.g. https://sign.zoho.com
    apiKeySecretName: 'PLACEHOLDER_ZOHO_SIGN_API_KEY_NAME', // Secrets Manager NAME, not the value
    webhookSecretName: 'PLACEHOLDER_ZOHO_SIGN_WEBHOOK_SECRET_NAME',
},
```

Cutover-checklist row template (`docs/cutover-checklist.md`), matching that table's actual columns
(`Status | Item | What it is | What unlocks it | Deferred verification` — copy the `email-outbound`/`twilio-sms`
row format exactly):

| Status | Item             | What it is                                                                                                  | What unlocks it                | Deferred verification                                                                                                                                                                                                                   |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜     | `esign-provider` | Zoho Sign / DocuSign account + API key + webhook signing secret (names in `apps/showcase/config/params.ts`) | you provision a vendor account | Real envelope creation through `packages/keel/src/adapters/real/esign.ts`; a signing ceremony completed by a real signer; the inbound `POST /api/webhooks/esign` verifies and pulls the signed PDF into an `attachments` row end-to-end |

The webhook secret rides the existing verified-inbound seam; no new secret _class_ — it's the
Mailgun/webhook shared-secret pattern with a different value.

## 5. What you do NOT build

- No new state-machine engine — reuse `packages/keel/src/core/state-machine.ts`.
- No new webhook-verification mechanism — reuse `packages/keel/src/service-auth/`'s
  HMAC/timestamp check.
- No new storage path — the signed PDF is an `attachments` row.
- No change to `packages/keel/src/core/gates.ts`'s evaluator — only a new fact key and a new
  `gatesFor…` bridge.

That is the whole point of the gate class: e-sign is a rider, not a rebuild.
