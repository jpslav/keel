import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GitHub issue forms are a surface no other gate looks at.
 *
 * Both forms shipped with `value:` sitting directly on the `- type: markdown` body item instead of
 * under `attributes:`. That is valid YAML and invalid schema, so nothing here noticed: `pnpm verify`
 * never reads `.github/`, and the only test that touched this directory
 * (`adopter-identity.test.ts`) reads `config.yml` for the maintainer handle without parsing the
 * forms. GitHub rejects a malformed form at render time — a stranger clicking "New issue" gets a
 * template error instead of the form, which kills the whole structured issue funnel on day one.
 * It is the same class as the workflow that parsed but declared `runner.temp` in a job-level `env:`
 * and so ran zero jobs: valid YAML, invalid context.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a structural check, not a schema validation. It
 * encodes the rules GitHub documents for issue forms, and it cannot prove GitHub accepts the file —
 * that needs either GitHub's own renderer or a fetched JSON schema, and `pnpm dev` stays hermetic
 * (no network, no new dependency for one gate). So it catches the defect classes below and does not
 * replace reading the rendered form once on the published repo.
 *
 * The rules checked, each one a way GitHub rejects a form outright:
 *   - a required top-level key is missing (`name`, `description`, `body`)
 *   - a body item carries content at item level instead of under `attributes:` (the shipped bug)
 *   - a body item has no `attributes:`, or is missing the content key its type requires
 *   - two body items share an `id` (the copy-paste mistake), or a `markdown` item has one at all
 *
 * Deliberately no YAML parser. These files are small, hand-written and Prettier-formatted, and a
 * line walk over `- type:` items is honest about being a line walk. Indentation is measured from the
 * file rather than assumed, so a 2-space form is read the same as this repo's 4-space one.
 */

const FORM_DIR = '.github/ISSUE_TEMPLATE'

/** `config.yml` is the chooser, not a form — it has no `body:` and a different schema. */
const NOT_A_FORM = new Set(['config.yml'])

/** https://docs.github.com/issues — the body item types GitHub accepts. */
const ITEM_TYPES = new Set(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'])

/** Top-level keys GitHub requires on every form. */
const REQUIRED_TOP_LEVEL = ['name', 'description', 'body']

/**
 * Keys that belong under `attributes:`. Finding one at item level is the shipped bug: the item
 * looks right, reads right, and GitHub refuses it.
 */
const ATTRIBUTE_KEYS = new Set(['value', 'label', 'description', 'options', 'placeholder', 'render'])

/** Keys GitHub allows at item level, beside `type`. */
const ITEM_KEYS = new Set(['type', 'id', 'attributes', 'validations'])

interface Item {
    line: number
    /** Keys written at the item's own indentation, in order. */
    keys: string[]
    /** Those keys' scalar values, unquoted. `type` and `id` are read from here, never from the dash line. */
    values: Record<string, string>
    /** Keys written one level under `attributes:`. */
    attributeKeys: string[]
}

/** YAML scalars may be quoted: `type: "markdown"` is the same value as `type: markdown`. */
function unquote(value: string): string {
    const trimmed = value.trim()
    const quoted = /^(['"])(.*)\1$/.exec(trimmed)
    return quoted ? quoted[2] : trimmed
}

interface Form {
    topLevelKeys: string[]
    items: Item[]
}

const KEY = /^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/
/** A `key: |` or `key: >` block scalar — its body is prose and must not be read as structure. */
const BLOCK_SCALAR = /:\s*[|>][-+]?\s*$/

/**
 * Walk a form. Top-level keys sit at column 0; a body item starts at `- type: <kind>`, its own keys
 * align with that `type`, and `attributes:`' children are indented past it. Both indents are read
 * from the file, never assumed. Block scalars are skipped wholesale.
 */
function parseForm(text: string): Form {
    const topLevelKeys: string[] = []
    const items: Item[] = []
    let current: Item | null = null
    let itemIndent = -1
    let inAttributes = false
    let attrChildIndent: number | null = null
    let blockIndent: number | null = null
    let inBody = false
    /** The dash column of the `body:` list, learned from its first entry. */
    let bodyDash: number | null = null

    for (const [index, line] of text.split('\n').entries()) {
        if (line.trim() === '') continue
        const indent = line.length - line.trimStart().length

        if (blockIndent !== null) {
            if (indent > blockIndent) continue
            blockIndent = null
        }

        // A body item starts at the dash, whatever key happens to come first — `- id: what` is as
        // valid as `- type: textarea`, and keying off `type` skipped such an item entirely, so a
        // duplicate id inside it went unseen. The whitespace after the dash is measured, not assumed.
        //
        // The `bodyDash` guard is what keeps this from swallowing NESTED lists: a `checkboxes` item's
        // `options:` entries are also `- label: …`, and without anchoring to the body list's own dash
        // column every option was read as a malformed body item.
        const start = /^(\s*)-(\s+)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
        if (start && inBody && (bodyDash === null || start[1].length === bodyDash)) {
            bodyDash ??= start[1].length
            current = { line: index + 1, keys: [start[3]], values: {}, attributeKeys: [] }
            current.values[start[3]] = unquote(start[4])
            items.push(current)
            itemIndent = start[1].length + 1 + start[2].length
            inAttributes = start[3] === 'attributes'
            attrChildIndent = null
            if (BLOCK_SCALAR.test(line)) blockIndent = itemIndent
            continue
        }
        if (start) continue // a nested list entry (e.g. an `options:` row), not a body item

        const key = KEY.exec(line)
        if (!key) continue
        if (BLOCK_SCALAR.test(line)) blockIndent = indent

        if (indent === 0) {
            topLevelKeys.push(key[1])
            current = null
            inBody = key[1] === 'body'
            continue
        }
        if (!current) continue

        if (indent === itemIndent) {
            current.keys.push(key[1])
            current.values[key[1]] = unquote(key[2])
            inAttributes = key[1] === 'attributes'
            attrChildIndent = null
        } else if (inAttributes && indent > itemIndent) {
            // The first key below `attributes:` establishes its child level; anything deeper is an
            // `options:` list entry or similar, not an attribute of its own.
            attrChildIndent ??= indent
            if (indent === attrChildIndent) current.attributeKeys.push(key[1])
        }
    }

    return { topLevelKeys, items }
}

const forms = readdirSync(FORM_DIR)
    .filter((f) => f.endsWith('.yml') && !NOT_A_FORM.has(f))
    .sort()

describe('GitHub issue forms are well-formed', () => {
    it('finds the forms', () => {
        expect(forms.length).toBeGreaterThan(0)
    })

    it.each(forms)('%s', (file) => {
        const { topLevelKeys, items } = parseForm(readFileSync(path.join(FORM_DIR, file), 'utf8'))
        expect(items.length).toBeGreaterThan(0)

        const problems: string[] = []
        const where = (line: number) => `${FORM_DIR}/${file}:${line}`

        for (const required of REQUIRED_TOP_LEVEL) {
            if (!topLevelKeys.includes(required)) {
                problems.push(`${FORM_DIR}/${file} has no top-level \`${required}:\``)
            }
        }

        const seen = new Map<string, number>()
        for (const item of items) {
            const type = item.values.type ?? ''
            const id = item.values.id
            if (!ITEM_TYPES.has(type)) {
                problems.push(`${where(item.line)} has unknown or missing body item type \`${type}\``)
            }

            // The shipped bug: content written at item level instead of under `attributes:`.
            for (const key of item.keys) {
                if (ATTRIBUTE_KEYS.has(key)) {
                    problems.push(`${where(item.line)} puts \`${key}\` on the item; it belongs under \`attributes:\``)
                } else if (!ITEM_KEYS.has(key)) {
                    problems.push(`${where(item.line)} has unexpected item key \`${key}\``)
                }
            }

            if (id !== undefined) {
                // GitHub keys responses by id, so a duplicate silently loses one answer — and a
                // `markdown` block is not a response at all, so it may not carry one.
                if (type === 'markdown') {
                    problems.push(`${where(item.line)} is \`markdown\` and must not have an \`id:\``)
                }
                const first = seen.get(id)
                if (first !== undefined) {
                    problems.push(`${where(item.line)} reuses id \`${id}\`, already used at line ${first}`)
                } else {
                    seen.set(id, item.line)
                }
            }

            if (!item.keys.includes('attributes')) {
                problems.push(`${where(item.line)} (\`${type}\`) has no \`attributes:\``)
                continue
            }

            // Every type requires exactly one content key; markdown takes `value`, the rest `label`.
            const required = type === 'markdown' ? 'value' : 'label'
            if (!item.attributeKeys.includes(required)) {
                problems.push(`${where(item.line)} (\`${type}\`) has no \`attributes.${required}\``)
            }
            if ((type === 'dropdown' || type === 'checkboxes') && !item.attributeKeys.includes('options')) {
                problems.push(`${where(item.line)} (\`${type}\`) has no \`attributes.options\``)
            }
        }

        expect(problems).toEqual([])
    })
})
