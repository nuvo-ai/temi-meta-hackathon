import type { ToolContext, ToolExecutor } from './types.js';

/** Forwards tool calls to Temi's banking backend: POST {tool, args, callerId, country} → JSON result. */
export class HttpExecutor implements ToolExecutor {
    constructor(private url: string, private key: string, private timeoutMs = 10_000) {
        if (!url) throw new Error('TOOL_EXECUTOR_URL is required when TOOL_EXECUTOR=http');
    }

    async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
            body: JSON.stringify({ tool: name, args, callerId: ctx.callerId, country: ctx.country ?? 'NG' }),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) return { error: `tool backend returned HTTP ${res.status}` };
        return res.json();
    }
}
