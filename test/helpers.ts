import type { AssembledMessage, Message, ModelClient, Tool, ToolCall } from '../src/model.js';

export const call = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
});

/** A model that replays scripted replies in order, streaming text word by word. */
export class ScriptedModel implements ModelClient {
    readonly label = 'scripted';
    seen: Message[][] = [];
    constructor(private replies: Array<{ text?: string; toolCalls?: ToolCall[] }>, private verdict = '{"decision":"allow","reasons":[]}') {}

    async *stream(messages: Message[], _tools: Tool[]): AsyncGenerator<string, AssembledMessage, void> {
        this.seen.push(messages);
        const next = this.replies.shift() ?? { text: '' };
        for (const word of (next.text ?? '').split(/(?<= )/)) if (word) yield word;
        return { content: next.text ?? '', toolCalls: next.toolCalls ?? [], usage: { inputTokens: 10, outputTokens: 5, estimated: false } };
    }

    async complete(): Promise<{ content: string; usage: AssembledMessage['usage'] }> {
        return { content: this.verdict, usage: { inputTokens: 10, outputTokens: 5, estimated: false } };
    }
}
