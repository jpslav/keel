import { describe, expect, it } from 'vitest'
import { fakeLlm } from 'keel/adapters/fake/llm'
import type { LlmContentBlock } from 'keel/ports/llm'
import { ASSISTANT_COMPOSE_SYSTEM, assistantComposePurpose, assistantConfig } from './assistant'

/**
 * Guards BOTH the tool-loop replay mechanic AND the fixture↔tool-def contract. The requests below are
 * byte-identical to what the assistant route builds from assistantConfig; if a tool def or the system
 * prompt drifts from the committed conversation fixture, the hash no longer matches, replay falls back
 * to the default (non-tool) answer, and these tests fail loudly — the fixture can't silently rot.
 */
describe('assistant tool loop', () => {
    const toolLoop = (question: string, execute: (call: { name: string; input: unknown }) => Promise<string>) =>
        fakeLlm.runToolLoop({
            purpose: assistantConfig.purpose,
            system: assistantConfig.system,
            messages: [{ role: 'user', content: question }],
            tools: assistantConfig.tools.map((tool) => tool.def),
            execute,
        })

    it('replays the recorded list_my_tickets call and runs execute LIVE (canned utterance, real result)', async () => {
        const calls: { name: string; input: unknown }[] = []
        // The "live" tool result — NOT present anywhere in the fixture. Proves the split.
        const liveResult = JSON.stringify({ tickets: [{ ref: 'NW-1041', subject: 'scanner', status: 'open' }] })

        const result = await toolLoop('What tickets are open?', async (call) => {
            calls.push(call)
            return liveResult
        })

        // The recorded model asked for exactly our tool.
        expect(calls).toEqual([{ name: 'list_my_tickets', input: {} }])

        // The returned conversation carries the LIVE tool result (from execute, not the fixture)...
        const blocks = result.turns.flatMap((t) => t.content)
        const toolResult = blocks.find(
            (b): b is Extract<LlmContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
        )
        expect(toolResult?.content).toBe(liveResult)

        // ...and the final text is the canned model utterance (mentions the tool it used).
        expect(result.text).toContain('list_my_tickets')
    })

    it('replays the SECOND tool, and relays the model-supplied input to execute', async () => {
        // The registry's second member is the one that takes arguments, so this is where the loop's
        // input relay is actually exercised — a one-tool assistant could never show it.
        const calls: { name: string; input: unknown }[] = []
        const result = await toolLoop('Has anyone reported the scanner dropping out?', async (call) => {
            calls.push(call)
            return JSON.stringify({ query: 'scanner', tickets: [] })
        })

        expect(calls).toEqual([{ name: 'search_tickets', input: { query: 'scanner' } }])
        expect(result.text).toContain('search_tickets')
    })

    it('falls back to the default answer (no tool call) for an unrecognized question', async () => {
        let executed = false
        const result = await toolLoop('What does this scaffold do?', async () => {
            executed = true
            return '{}'
        })
        expect(executed).toBe(false)
        expect(result.text).toContain('deterministic')
    })
})

/**
 * The streaming half. The compose pass has no recorded entry ON PURPOSE — its prompt carries live
 * ticket facts, so it can never hash-match — and this pins that the fall-through is deterministic
 * rather than accidental: two different live inputs, the same replayed prose, delivered in chunks.
 */
describe('assistant compose pass (streamed)', () => {
    const streamText = async (facts: string) => {
        const chunks: string[] = []
        for await (const chunk of fakeLlm.stream({
            purpose: assistantComposePurpose,
            system: ASSISTANT_COMPOSE_SYSTEM,
            messages: [
                { role: 'user', content: 'What tickets are open?' },
                { role: 'assistant', content: 'I read the queue.' },
                { role: 'user', content: `Ticket facts:\n${facts}` },
            ],
        })) {
            chunks.push(chunk)
        }
        return chunks
    }

    it('streams in more than one chunk', async () => {
        const chunks = await streamText('NW-1041 — scanner')
        expect(chunks.length).toBeGreaterThan(1)
        expect(chunks.join('')).toContain('queue')
    })

    it('is deterministic across different live facts (the default entry answers both)', async () => {
        const a = (await streamText('NW-1041 — scanner')).join('')
        const b = (await streamText('NW-1028 — invoice tax rate')).join('')
        expect(a).toBe(b)
    })
})
