import OpenAI from 'openai';
import type {
    ChatCompletionFunctionTool,
    ChatCompletionMessageParam,
    ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import type { ProviderConfig } from './config.js';

export type Message = ChatCompletionMessageParam;
export type Tool = ChatCompletionFunctionTool;
export type ToolCall = Extract<ChatCompletionMessageToolCall, { type: 'function' }>;

export interface Usage {
    inputTokens: number;
    outputTokens: number;
    /** True when the provider didn't report usage and we estimated from characters. */
    estimated: boolean;
}

export interface AssembledMessage {
    content: string;
    toolCalls: ToolCall[];
    usage: Usage;
}

/**
 * The one thing the agent needs from a model: stream text deltas, then return
 * the assembled message (text + tool calls). Kept as an interface so tests and
 * evals can swap providers without touching the agent loop.
 */
export interface ModelClient {
    readonly label: string;
    stream(messages: Message[], tools: Tool[], signal?: AbortSignal): AsyncGenerator<string, AssembledMessage, void>;
    complete(messages: Message[], signal?: AbortSignal): Promise<{ content: string; usage: Usage }>;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class OpenAICompatibleClient implements ModelClient {
    readonly label: string;
    private client: OpenAI;

    constructor(private cfg: ProviderConfig) {
        if (!cfg.apiKey) throw new Error(`No API key set for provider "${cfg.name}"`);
        this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: 20_000, maxRetries: 1 });
        this.label = `${cfg.name}:${cfg.model}`;
    }

    async *stream(messages: Message[], tools: Tool[], signal?: AbortSignal): AsyncGenerator<string, AssembledMessage, void> {
        const stream = await this.client.chat.completions.create(
            {
                model: this.cfg.model,
                messages,
                stream: true,
                ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
                ...(this.cfg.streamUsage ? { stream_options: { include_usage: true } } : {}),
                ...this.cfg.extraBody,
            },
            { signal },
        );

        let content = '';
        // Tool-call fragments arrive incrementally, keyed by index.
        const acc = new Map<number, { id: string; name: string; args: string }>();
        let reported: { prompt_tokens: number; completion_tokens: number } | undefined;

        for await (const chunk of stream) {
            if (chunk.usage) reported = chunk.usage;
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
                content += delta.content;
                yield delta.content;
            }
            for (const tc of delta.tool_calls ?? []) {
                const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name = tc.function.name;
                if (tc.function?.arguments) cur.args += tc.function.arguments;
                acc.set(tc.index, cur);
            }
        }

        const toolCalls: ToolCall[] = [...acc.values()]
            .filter((t) => t.name)
            .map((t, i) => ({
                id: t.id || `call_${i}`,
                type: 'function',
                function: { name: t.name, arguments: t.args || '{}' },
            }));

        const usage: Usage = reported
            ? { inputTokens: reported.prompt_tokens, outputTokens: reported.completion_tokens, estimated: false }
            : {
                inputTokens: estimateTokens(JSON.stringify(messages) + JSON.stringify(tools)),
                outputTokens: estimateTokens(content + JSON.stringify(toolCalls)),
                estimated: true,
            };

        return { content, toolCalls, usage };
    }

    async complete(messages: Message[], signal?: AbortSignal): Promise<{ content: string; usage: Usage }> {
        const res = await this.client.chat.completions.create(
            { model: this.cfg.model, messages, ...this.cfg.extraBody },
            { signal },
        );
        const content = res.choices[0]?.message?.content ?? '';
        const usage: Usage = res.usage
            ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens, estimated: false }
            : { inputTokens: estimateTokens(JSON.stringify(messages)), outputTokens: estimateTokens(content), estimated: true };
        return { content, usage };
    }
}
