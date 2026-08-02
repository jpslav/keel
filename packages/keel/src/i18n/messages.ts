/**
 * The framework half of the i18n catalog, and the merge that composes it with the app's half
 * (ADR-0012). The catalogs are PHYSICALLY split along the namespace partition:
 * `packages/keel/src/i18n/messages/*.json` holds the FRAMEWORK_NAMESPACES, the host app's
 * `messages/*.json` holds APP_NAMESPACES, and every load site merges the two.
 *
 * Three load sites, one merge: the Next request config (`./request.ts`), the static demo shell
 * (`src/demo-static/main.tsx`), and the tests that prove en/es parity over the MERGED tree.
 */

/** A next-intl message catalog: nested namespaces of ICU strings. */
export type MessageTree = { [key: string]: string | MessageTree }

/**
 * Deep-merge catalogs, later trees winning per leaf. The framework/app namespaces are disjoint at the
 * top level (namespaces.test.ts proves it), so this never actually overwrites today — the merge is deep
 * anyway so an app CAN override a single framework string without forking a whole namespace.
 */
export function mergeMessages(...trees: MessageTree[]): MessageTree {
    const out: MessageTree = {}
    for (const tree of trees) {
        for (const [key, value] of Object.entries(tree)) {
            const existing = out[key]
            out[key] =
                typeof value === 'object' && typeof existing === 'object' ? mergeMessages(existing, value) : value
        }
    }
    return out
}

/** The framework catalog for one locale (dynamic so each locale stays its own chunk). */
export async function loadFrameworkMessages(locale: string): Promise<MessageTree> {
    return (await import(`./messages/${locale}.json`)).default as MessageTree
}
