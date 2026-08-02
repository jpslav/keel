# Auth UI playbook — pulling more from Clerk without swallowing its API

This is the repeatable recipe for adding an auth capability (MFA, password reset, avatar upload,
sign-up, connected accounts, more org management) so that **dev looks and behaves like prod** while the
app never depends on Clerk's full surface. It operationalises ADR-0003.

## The principle

Clerk sits behind a **narrow `auth` port** (`packages/keel/src/ports/auth.ts`) sized to what the app
needs — never to Clerk's API. There is **one custom Mantine auth UI** in every mode; the fake adapter and the
real (Clerk) adapter both sit behind it. We treat Clerk two ways, and only these two:

1. **As a design reference.** Clerk's MIT-licensed `ui` package in the `clerk/javascript` repo is a
   catalogue of well-thought component _anatomy_ (see
   `packages/keel/src/components/auth/preview-row.tsx`, mined from Clerk's
   `OrganizationPreview`/`UserPreview`). Read it, re-express it in Mantine. Do **not**
   import it — it's an internal package bound to a live clerk-js client, and pulling it in reintroduces the
   whole surface the port exists to hide (ADR-0003).
2. **As a real adapter.** Clerk's headless server/client APIs are called **only** inside
   `packages/keel/src/adapters/real/*` (lint-enforced). `<ClerkProvider>`
   (`packages/keel/src/adapters/real/providers.tsx`) is the runtime for any client-side Clerk call;
   it's mounted only in real mode and renders no UI.

## The recipe — one pass per capability

For each new capability, work these six steps in order:

1. **Size a port seam.** Add the smallest method(s) to `AuthPort` that the app needs, in the app's
   vocabulary (e.g. `enrollTotp(): Promise<{ uri: string }>`, `verifyTotp(code)`), never mirroring
   Clerk's shape. Put the types next to the existing ones in `packages/keel/src/ports/auth.ts`.
2. **Implement the fake adapter** (`packages/keel/src/adapters/fake/auth.ts`) so dev/demo/E2E
   exercise it hermetically — persist state under `.data/` with the read-JSON-or-default pattern
   already used for invites/people, and if it needs a dev control, surface it in **Simulator**
   (simulated-mode-only), not the product UI.
3. **Implement the real adapter** (`packages/keel/src/adapters/real/auth.ts` or a sibling `*.tsx`
   for client flows), naming the exact Clerk headless API in a comment. Mark it `AUTHORED — CUTOVER`
   until it's run against a live instance.
4. **Build the owned Mantine surface** in `packages/keel/src/components/auth/` (or a section of an
   existing screen), router-agnostic (data + callbacks as props). Auth is FRAMEWORK code, so its copy
   goes in the FRAMEWORK half of the split catalog — `packages/keel/src/i18n/messages/{en,es}.json`,
   under a framework namespace (`auth`, `profile`, `org`, `acceptInvite`). Putting an auth key in an
   app's `apps/<app>/messages/{en,es}.json` fails `packages/keel/src/i18n/namespaces.test.ts`, which
   holds the two halves DISJOINT; the app catalog is for namespaces the app registers through
   `apps/<app>/src/app-config/messages.ts`. Both halves stay key- and placeholder-identical across
   en/es. If a Clerk client _form_ is unavoidable (sign-in, ticket sign-up), slot it into an owned shell
   and pass **all copy as `labels`** — the one-auth-UI pattern (`RealSignInForm`,
   `RealAcceptInviteForm`); never let vendor-side strings leak.
5. **Prove it.** Add a Ladle story beside the screen (`packages/keel/src/components/auth/*.stories.tsx`
   — `apps/showcase/.ladle/config.mjs` serves both halves of the repo), wire the screen into an app's
   static demo twin (`apps/showcase/src/demo-static/app.tsx` is the worked one), add an e2e path, and
   keep the axe sweep green (open popovers included — see the avatar/Menu notes in build-notes).
6. **Record the cutover.** Anything needing a live Clerk instance to verify gets a row (or a clause on
   the `auth-dev` row) in `docs/cutover-checklist.md` with the exact deferred verification.

## Clerk component → house surface

| Clerk component                                                               | House surface                                   | Status  | Notes / the Clerk API a seam would call                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `<SignIn>`                                                                    | `SignInScreen` + `RealSignInForm` (labels slot) | done    | Clerk v7 signals API; MFA branch is a seam (below)                        |
| `<UserButton>`                                                                | `UserMenu` + `PreviewRow`                       | done    | avatar trigger → preview-row header + account actions                     |
| `<OrganizationSwitcher>`                                                      | `OrgSwitcher` + `PreviewRow`                    | done    | trigger + membership popover with role sub-lines + active check           |
| `<OrganizationProfile>`                                                       | `OrgScreen` (members + pending sections)        | partial | member roles/removal + revoke-invite are future seams                     |
| `<UserProfile>`                                                               | `ProfileScreen` (Profile + Security sections)   | partial | Security section is a named seam for the three below                      |
| — MFA                                                                         | Security section                                | seam    | `user.createTOTP()` / `user.verifyTOTP()`; rides the gate seam (ADR-0003) |
| — Password reset                                                              | sign-in / Security                              | seam    | `signIn.create({ strategy: 'reset_password_email_code' })` …              |
| — Avatar upload                                                               | Profile section                                 | seam    | `user.setProfileImage({ file })`                                          |
| `<SignUp>`                                                                    | accept-invite today; open sign-up later         | seam    | `signUp.*`; today only ticket-strategy accept-invite exists               |
| `<CreateOrganization>`                                                        | new-team screen                                 | seam    | `clerkClient.organizations.createOrganization(...)`                       |
| `<GoogleOneTap>` / `<Waitlist>` / Billing (`<PricingTable>`, `<Checkout>`, …) | —                                               | never   | out of scope for this product                                             |

## What we never build

The Clerk billing components (`PricingTable`, `Checkout`, `PaymentMethods`, `Subscriptions`, …),
`Waitlist`, and `GoogleOneTap`. If billing is ever needed it gets its own port, not a Clerk-UI import.
