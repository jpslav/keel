import type { TourDefinition } from 'keel/demo-static/tour/contracts'

/**
 * The APP's registered TOURS (the seam side of the Simulator Tours tab, ADR-0012). A tour is a scripted
 * walkthrough: a ghost cursor drives the real screens while a bar narrates, so `dist-demo/index.html`
 * (one file you can email to someone) can be watched instead of read about. keel owns the engine and
 * the tab; what a tour SAYS and what it CLICKS is app vocabulary, and lives here.
 *
 * A real adopter replaces this file with their own tour, or with `[]` (apps/starter does — the tab then
 * does not render at all).
 *
 * ── Conventions this file follows, and /new-tour repeats ──────────────────────────────────────────
 *
 * **Narration** carries fully-qualified keys into the app catalog (`apps/showcase/messages/*.json`,
 * `tours` namespace), resolved by the engine with the root translator — the same shape an app-registered
 * Simulator flag's `labelKey` uses. `<b>` marks the one term per step that matters.
 *
 * **Selectors** prefer a role-named hook that survives a restyle. The `data-testid` attributes already
 * on these screens ARE such hooks, so they are reused rather than duplicated; `data-tour="…"` is added
 * to a component only where nothing stable exists (today: the analyze button and the escalation accept
 * button, whose testids carry a row id that differs between the server and the static twin).
 *
 * **Submissions go in `advance`,** never in `script`: the world changes when the person watching
 * presses Next, not on a timer. That rule has a second, mechanical reason here — a server host reloads
 * the page after a snapshot restore or a feature-flag flip, and `advance` is the boundary the engine's
 * resume marker is written at. Anything in a `script` may therefore be re-run after a reload, so it
 * must be idempotent (the team switch below is; a flag toggle is not, which is why it is an `advance`).
 *
 * **Typed content is simulated data, not UI copy,** so it stays in one language like the rest of the
 * seed corpus (`packages/seed`): a customer's email reads the same in the Spanish demo, because the
 * customer wrote it, not the product.
 */

/** The email the tour sends into the desk. A constant because two steps need it: one types it, the
 *  next asserts the queue is showing it. */
const INBOUND_SUBJECT = 'Label printer prints blank labels'
const INBOUND_BODY =
    'Since this morning the label printer feeds a blank label for every order. Same on both machines. We have restarted them and re-loaded the roll.'

/** The reference the desk will give that email. Deterministic: the tour resets the world first, and the
 *  seeded Northwind queue ends at NW-1041. If the seed corpus grows, this tour fails in CI, which is
 *  the correct outcome — the narration says NW-1042 out loud. */
const NEW_TICKET_REF = 'NW-1042'

/** The teammate the `mid-demo` preset invites (src/app-config/simulator.ts). Simulated data, like the
 *  ticket subjects above: the tour types their name and then looks for it. */
const INVITEE_NAME = 'Jordan Ellis'

export const tours: TourDefinition[] = [
    {
        id: 'ticket-end-to-end',
        titleKey: 'tours.ticketTitle',
        summaryKey: 'tours.ticketSummary',
        // Restore the seeded desk first, so the story always starts from the same shift.
        snapshot: 'reset',
        steps: [
            {
                textKey: 'tours.ticketStep1',
                script: [['panel', 'people']],
                // Becoming someone is a world change, so it waits for Next like every other one — and
                // on the server host it is also a reload (the viewpoint POST redirects), which is the
                // other reason it cannot sit in an entry script: the resume would click it again.
                advance: [['click', '[data-testid="people-person-admin"]']],
            },
            {
                textKey: 'tours.ticketStep2',
                spotlight: '[data-testid="tickets-card"]',
                script: [['expectText', '[data-testid="tickets-list"]', 'NW-1028']],
            },
            {
                textKey: 'tours.ticketStep3',
                script: [
                    ['panel', 'mail'],
                    ['select', '[data-testid="inbound-compose-from"]', 'dana.okoye@example.test'],
                    ['select', '[data-testid="inbound-compose-org"]', 'frontline'],
                    ['type', '[data-testid="inbound-compose-handler"]', 'support'],
                    ['type', '[data-testid="inbound-compose-subject"]', INBOUND_SUBJECT],
                    ['type', '[data-testid="inbound-compose-body"]', INBOUND_BODY],
                ],
                advance: [['click', '[data-testid="inbound-compose-send"]']],
            },
            {
                textKey: 'tours.ticketStep4',
                script: [
                    ['expectText', '[data-testid="inbound-list"]', 'handled'],
                    ['click', '[data-testid="nav-dashboard"]'],
                    ['expectText', '[data-testid="tickets-list"]', INBOUND_SUBJECT],
                ],
            },
            {
                textKey: 'tours.ticketStep5',
                script: [['move', `[data-testid="ticket-assignee-${NEW_TICKET_REF}"]`]],
                // Opening the picker and choosing both happen on Next: a Mantine combobox closes when
                // anything outside it is clicked, and the Next button is outside it.
                advance: [
                    ['click', `[data-testid="ticket-assignee-${NEW_TICKET_REF}"]`],
                    ['pause', 400],
                    ['click', '[data-combobox-option][value="person-staff"]'],
                ],
            },
            {
                textKey: 'tours.ticketStep6',
                script: [
                    ['panel', 'mail'],
                    ['click', '[data-testid="mail-scope-all"]'],
                    ['expectText', '[data-testid="mail-list"]', 'sam.rivera@example.test'],
                ],
            },
            {
                textKey: 'tours.ticketStep7',
                script: [['panel', 'snapshots']],
                advance: [['click', '[data-testid="flag-toggle-jobs-held"]']],
            },
            {
                textKey: 'tours.ticketStep8',
                spotlight: '[data-tour="analyze-bundle"]',
                script: [
                    ['click', '[data-testid="nav-dashboard"]'],
                    ['scrollTo', '[data-testid="attachments-card"]'],
                ],
                advance: [['click', '[data-tour="analyze-bundle"]']],
            },
            {
                textKey: 'tours.ticketStep9',
                script: [
                    ['panel', 'actors'],
                    ['expect', '[data-testid="actor-card-bundle-analyzer"]'],
                    // The analyzer's own log, then the job it finished on the desk's side. Both are
                    // waits, not clicks: this step is watching an autonomous process do its work.
                    ['expect', '[data-testid="actor-log-entry"]'],
                    ['expect', '[data-testid="job-timeline-entry-completed"]'],
                ],
            },
            {
                textKey: 'tours.ticketStep10',
                script: [
                    ['click', '[data-testid="nav-dashboard"]'],
                    // Idempotent by construction: the switcher ignores a click on the active team, so a
                    // host that reloads on a team switch can re-run this script safely.
                    ['click', '[data-testid="org-switcher"]'],
                    ['pause', 400],
                    ['click', '[data-testid="org-switcher-item-platform"]'],
                    ['expect', '[data-tour="escalation-accept"]'],
                ],
            },
            {
                // The endpoint is registered on the ANSWERING team, and it has to be: a webhook is
                // scoped to the team whose event it is, so an endpoint on the raising desk would never
                // hear this decision. Registering it after the team switch is the story AND the truth.
                textKey: 'tours.ticketStep11',
                script: [
                    ['click', '[data-testid="nav-org"]'],
                    ['scrollTo', '[data-testid="webhook-endpoints-card"]'],
                    // Event kind first, THEN the url: typing focuses the field it types into, and that
                    // focus change is what closes the combobox. Picking last would leave the option
                    // list floating over the Create button the next press has to reach.
                    ['click', '[data-testid="webhook-event-kinds"]'],
                    ['pause', 400],
                    ['click', '[data-combobox-option][value="escalation.decided"]'],
                    ['type', '[data-testid="webhook-url"]', 'https://partner.example.test/hooks/desk'],
                ],
                advance: [['click', '[data-testid="webhook-create"]']],
            },
            {
                textKey: 'tours.ticketStep12',
                spotlight: '[data-tour="escalation-accept"]',
                script: [['click', '[data-testid="nav-dashboard"]']],
                advance: [['click', '[data-tour="escalation-accept"]']],
            },
            {
                textKey: 'tours.ticketStep13',
                script: [
                    ['panel', 'hooks'],
                    ['expectText', '[data-testid="simulator-hook-deliveries"]', 'escalation.decided'],
                ],
                // The attempt is the world's to make, so it waits for Next like every other change.
                advance: [['click', '[data-testid="simulator-hooks-run-due"]']],
            },
            {
                textKey: 'tours.ticketStep14',
                script: [
                    // Prefix match: a delivery's testid carries its id, and the tour is talking about
                    // the one delivery there is.
                    ['click', '[data-testid^="simulator-hook-delivery-toggle-"]'],
                    ['expect', '[data-testid^="simulator-hook-delivery-signature-"]'],
                ],
            },
            {
                textKey: 'tours.ticketStep15',
                script: [['click', '[data-testid="nav-dashboard"]'], ['panel'], ['scrollTop']],
            },
        ],
    },
    {
        // The second tour exists to start from a PRESET rather than from the seed: `mid-demo` puts two new
        // tickets in the queue and a pending invite in someone's inbox, and signs the viewer in as Dana —
        // so step 1 opens on a shift already in progress, on the server and in the `file://` demo alike
        // (keel/core/presets.ts). It walks the invite to its end: from a person with no account to a
        // member of the desk.
        id: 'invite-from-preset',
        titleKey: 'tours.inviteTitle',
        summaryKey: 'tours.inviteSummary',
        snapshot: 'mid-demo',
        steps: [
            {
                textKey: 'tours.inviteStep1',
                spotlight: '[data-testid="tickets-card"]',
                script: [['expectText', '[data-testid="tickets-list"]', 'Refund stuck in pending']],
            },
            {
                textKey: 'tours.inviteStep2',
                script: [
                    ['panel', 'people'],
                    ['expectText', '[data-testid="simulator-people"]', 'jordan.ellis@example.test'],
                ],
                // A viewpoint switch, and on the server a reload — so it waits for Next.
                advance: [['click', '[data-testid^="people-"]:has([data-testid="people-invited-badge"])']],
            },
            {
                textKey: 'tours.inviteStep3',
                script: [
                    ['panel', 'mail'],
                    ['click', '[data-testid^="mail-item-"]'],
                    ['expect', '[data-testid="mail-link"]'],
                ],
            },
            {
                textKey: 'tours.inviteStep4',
                spotlight: '[data-testid="mail-link"]',
                advance: [['click', '[data-testid="mail-link"]']],
            },
            {
                textKey: 'tours.inviteStep5',
                script: [['type', '[data-testid="accept-name"]', INVITEE_NAME]],
                advance: [['click', '[data-testid="accept-submit"]']],
            },
            {
                textKey: 'tours.inviteStep6',
                spotlight: '[data-testid="signed-in-as"]',
                script: [['expectText', '[data-testid="signed-in-as"]', INVITEE_NAME]],
            },
            {
                textKey: 'tours.inviteStep7',
                script: [
                    ['panel', 'people'],
                    ['expectText', '[data-testid="simulator-people"]', INVITEE_NAME],
                ],
            },
            {
                textKey: 'tours.inviteStep8',
                script: [
                    ['panel', 'snapshots'],
                    ['expect', '[data-testid="simulator-presets"]'],
                ],
            },
        ],
    },
]
