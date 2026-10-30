import type { ProviderConfig } from './config.js';

// Chat Completions shapes, as the Meta Model API speaks them.
export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}
export type Message =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };
export interface Tool {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Usage {
    inputTokens: number;
    outputTokens: number;
    /** Part of outputTokens spent reasoning, when the provider reports it. */
    reasoningTokens?: number;
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
 * the assembled message (text + tool calls). Kept as an interface so tests can
 * swap in a scripted model without touching the agent loop.
 */
export interface ModelClient {
    readonly label: string;
    stream(messages: Message[], tools: Tool[], signal?: AbortSignal): AsyncGenerator<string, AssembledMessage, void>;
    complete(messages: Message[], signal?: AbortSignal): Promise<{ content: string; usage: Usage }>;
}

interface ReportedUsage {
    prompt_tokens: number;
    completion_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
}

interface StreamChunk {
    usage?: ReportedUsage | null;
    choices?: Array<{
        delta?: {
            content?: string | null;
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
    }>;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
const toUsage = (u: ReportedUsage): Usage => ({
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
    estimated: false,
});

/** Client for the Meta Model API (https://api.meta.ai/v1), over plain fetch. */
export class MetaClient implements ModelClient {
    readonly label: string;
    private maxRetries: number;

    constructor(private cfg: ProviderConfig, private timeoutMs = 20_000) {
        if (!cfg.apiKey) throw new Error('No Meta API key set: add MODEL_API_KEY to .env');
        // Live calls can't wait through many retries; evals raise this to ride out flaky connections.
        this.maxRetries = Number(process.env['MODEL_MAX_RETRIES'] ?? 1);
        this.label = `meta:${cfg.model}`;
    }

    /** POST to /chat/completions, retrying connection errors, 429s and 5xxs before any output arrives. */
    private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
        const signals = [AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])];
        for (let attempt = 0; ; attempt++) {
            let res: Response;
            try {
                res = await fetch(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
                    body: JSON.stringify({ model: this.cfg.model, ...body, ...this.cfg.extraBody }),
                    signal: AbortSignal.any(signals),
                });
            } catch (err) {
                if (signals.some((s) => s.aborted)) throw err;
                if (attempt < this.maxRetries) continue;
                throw new Error(`Meta Model API connection error: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (res.ok) return res;
            if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
            throw new Error(`Meta Model API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
    }

    async *stream(messages: Message[], tools: Tool[], signal?: AbortSignal): AsyncGenerator<string, AssembledMessage, void> {
        const res = await this.post(
            { messages, stream: true, ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}) },
            signal,
        );

        let content = '';
        // Tool-call fragments arrive incrementally, keyed by index.
        const acc = new Map<number, { id: string; name: string; args: string }>();
        let reported: ReportedUsage | undefined;

        const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                const chunk = JSON.parse(data) as StreamChunk;
                if (chunk.usage) reported = chunk.usage;
                const delta = chunk.choices?.[0]?.delta;
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
        }

        const toolCalls: ToolCall[] = [...acc.values()]
            .filter((t) => t.name)
            .map((t, i) => ({
                id: t.id || `call_${i}`,
                type: 'function',
                function: { name: t.name, arguments: t.args || '{}' },
            }));

        const usage: Usage = reported
            ? toUsage(reported)
            : {
                inputTokens: estimateTokens(JSON.stringify(messages) + JSON.stringify(tools)),
                outputTokens: estimateTokens(content + JSON.stringify(toolCalls)),
                estimated: true,
            };

        return { content, toolCalls, usage };
    }

    async complete(messages: Message[], signal?: AbortSignal): Promise<{ content: string; usage: Usage }> {
        const res = await this.post({ messages }, signal);
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: ReportedUsage };
        const content = body.choices?.[0]?.message?.content ?? '';
        const usage: Usage = body.usage
            ? toUsage(body.usage)
            : { inputTokens: estimateTokens(JSON.stringify(messages)), outputTokens: estimateTokens(content), estimated: true };
        return { content, usage };
    }
}
