/**
 * Static-demo twin of the fake llm's runToolLoop (../adapters/fake/llm.ts, ADR-0006/-0009). That
 * adapter reads its fixture off disk with node:fs, which no `file://` bundle can do — so the twin
 * takes the already-imported fixture as data and replays it in the browser.
 *
 * The committed fixture holds the recorded MODEL turns; replay drives them one at a time and runs the
 * caller's `execute` LIVE for each tool_use, so the tool RESULT comes from the in-memory demo world —
 * canned utterances, live effects, exactly the replay-honesty split the server makes. Which fixture
 * (and which tools) is APP vocabulary; the replay mechanism is not, so only the mechanism lives here.
 */

/** One content block of a recorded assistant turn — `text` for an utterance, `tool_use` for a call. */
interface FixtureBlock {
    type: string
    text?: string
    name?: string
    /** A recorded tool_use's arguments. Relayed to `execute` so a tool that TAKES input behaves the
     *  same in the browser twin as it does on the server. */
    input?: unknown
}

/** One recorded fixture entry. `request: null` marks the purpose's default/fallback answer. */
interface FixtureEntry {
    request: { messages?: { role: string; content: string }[] } | null
    response?: string | null
    conversation?: { role: string; content: FixtureBlock[] }[]
}

/** The shape of a committed fixtures/llm/*.json file, as far as browser replay cares. */
export interface AssistantFixture {
    entries: FixtureEntry[]
}

/**
 * Replay `question` against `fixture`, running `execute(toolName, input)` for every recorded tool_use before
 * returning the turn's text. Falls back to the fixture's default answer when the question matches no
 * recorded conversation — the same fallback the fake adapter makes, so an unrecorded question is
 * answered rather than thrown at a demo audience.
 */
export async function replayAssistant(
    fixture: AssistantFixture,
    question: string,
    execute: (toolName: string, input: unknown) => Promise<string>,
): Promise<string> {
    const fallback = fixture.entries.find((e) => e.request === null)?.response ?? 'fixture missing'
    const conversation = fixture.entries.find(
        (e) => e.conversation && e.request?.messages?.[0]?.content === question,
    )?.conversation
    if (!conversation) return fallback
    for (const turn of conversation) {
        const toolUses = turn.content.filter((b) => b.type === 'tool_use')
        for (const call of toolUses) await execute(call.name ?? '', call.input)
        if (toolUses.length === 0) {
            return turn.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text ?? '')
                .join('')
        }
    }
    return fallback
}
