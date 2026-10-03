/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). The framework panel (packages/keel/src/components/simulator/simulator-panel.tsx) owns its subsystem
 * tabs (people, mail, messages, events, jobs, hooks, errors, snapshots) and its two feature flags
 * (demo-banner, jobs-held — KNOWN_FLAGS in packages/keel/src/adapters/fake/analytics.ts); the app registers its OWN
 * Simulator tabs + flags HERE. A real adopter replaces this file (its own tabs/flags, or none). PURE
 * TypeScript, no framework imports — shared by the server glue and the static-demo twin.
 *
 * labelKey is resolved by the HOST glue from the `simulator` i18n namespace (matching how the panel
 * labels its own tabs): the seam carries the key, the host translates it and supplies the ReactNode
 * content, so the panel stays router-/data-blind (ADR-0006).
 */

/** One app-registered Simulator tab. The host translates `labelKey` and supplies the tab's content. */
interface AppSimulatorTab {
    id: string
    labelKey: string
    /** Once opened, keep the content running (hidden) through tab switches and collapse — the panel's
     *  `SimulatorExtraTab.keepMounted`. */
    keepMounted?: boolean
}

/**
 * The demo's one Simulator tab: Actors — in-page automations driving the real service/webhook surfaces
 * (see src/app-config/actors.ts). Rendered between Hooks and Errors via the panel's `extraTabs` prop.
 */
// keepMounted: the actors' tick loops live in this tab's content, so leaving the tab (to watch Jobs
// drain, say) must not stop them.
export const tabs: AppSimulatorTab[] = [{ id: 'actors', labelKey: 'actorsTab', keepMounted: true }]

/** One app-registered Snapshots feature flag. `labelKey` is a FULLY-QUALIFIED path into the APP catalog
 *  (`namespace.key`) — a flag an app invents is app vocabulary, so its copy ships with the app. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

/**
 * App feature flags for the Snapshots tab, composed into KNOWN_FLAGS
 * (packages/keel/src/adapters/fake/analytics.ts); snapshots-app.tsx resolves a registered flag's `labelKey`
 * when labelling its toggle.
 *
 * `sla-breach-banner` is the worked example the extension point used to ship without: a desk-specific
 * knob (highlight tickets past their SLA) that no framework flag could reasonably own, flipped from the
 * same Snapshots tab as the framework's own two. It is read by the tickets card, so flipping it changes
 * the product, not just the panel.
 */
export const flags: AppSimulatorFlag[] = [{ id: 'sla-breach-banner', labelKey: 'tickets.slaFlagLabel' }]
