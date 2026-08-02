import Anthropic from '@anthropic-ai/sdk'
import { LLM_MODELS } from '../../core/llm-models'
import type { LlmContentBlock, LlmPort, LlmRequest, LlmTurn } from '../../ports/llm'

/**
 * AUTHORED — CUTOVER (`llm-key`): typechecked, never run against the real API. Also used by each
 * app's own `scripts/llm-record.ts` to (re)record fixtures. The `llm-key` cutover row's deferred
 * verification covers BOTH: re-recording the conversation fixtures AND running one live tool loop
 * (`runToolLoop` below — tool_use/tool_result blocks, loop until end_turn or maxTurns).
 */
export function createRealLlm(apiKey: string): LlmPort {
    const client = new Anthropic({ apiKey })

    const toParams = (request: LlmRequest) => ({
        model: request.model ?? LLM_MODELS.default,
        system: request.system,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 1024,
    })

    return {
        async complete(request) {
            const message = await client.messages.create(toParams(request))
            const text = message.content
                .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                .map((block) => block.text)
                .join('')
            return { text }
        },

        async *stream(request) {
            const stream = client.messages.stream(toParams(request))
            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    yield chunk.delta.text
                }
            }
        },

        async runToolLoop(request) {
            const tools: Anthropic.Tool[] = request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
            }))
            // Running SDK message history (assistant + tool_result turns), fed back each round.
            const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
                role: m.role,
                content: m.content,
            }))
            // Port-shaped view of the same conversation (serializes to the fixture format).
            const turns: LlmTurn[] = []
            const maxTurns = request.maxTurns ?? 6

            for (let round = 0; round < maxTurns; round++) {
                const message = await client.messages.create({
                    model: request.model ?? LLM_MODELS.default,
                    system: request.system,
                    messages,
                    tools,
                    max_tokens: request.maxTokens ?? 1024,
                })

                const assistantBlocks: LlmContentBlock[] = []
                for (const block of message.content) {
                    if (block.type === 'text') assistantBlocks.push({ type: 'text', text: block.text })
                    else if (block.type === 'tool_use')
                        assistantBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
                    // Other block types (thinking, server tools) aren't used by this surface.
                }
                turns.push({ role: 'assistant', content: assistantBlocks })
                messages.push({ role: 'assistant', content: message.content })

                if (message.stop_reason !== 'tool_use') {
                    return { text: textOf(assistantBlocks), turns }
                }

                // Relay each tool_use to the app's executor LIVE, then feed all results back at once.
                const toolResults: Anthropic.ToolResultBlockParam[] = []
                const resultBlocks: LlmContentBlock[] = []
                for (const block of message.content) {
                    if (block.type !== 'tool_use') continue
                    // Defense-in-depth mirror of the fake adapter: never execute a tool_use whose
                    // name the app didn't supply — the model is untrusted (see the port trust model).
                    const known = request.tools.some((t) => t.name === block.name)
                    const result = known
                        ? await request.execute({ name: block.name, input: block.input })
                        : `unknown tool: ${block.name}`
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
                    resultBlocks.push({ type: 'tool_result', toolUseId: block.id, content: result })
                }
                messages.push({ role: 'user', content: toolResults })
                turns.push({ role: 'user', content: resultBlocks })
            }

            // Hit maxTurns without an end_turn: return the last assistant text.
            const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
            return { text: lastAssistant ? textOf(lastAssistant.content) : '', turns }
        },
    }
}

function textOf(blocks: LlmContentBlock[]): string {
    return blocks
        .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')
}
