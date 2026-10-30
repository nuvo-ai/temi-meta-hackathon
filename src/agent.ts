import { DEFAULT_COUNTRY, type Country } from './countries.js';
import type { ToolExecutor } from './executors/types.js';
import type { FraudGuard, GuardResult } from './guard.js';
import type { Message, ModelClient, ToolCall, Usage } from './model.js';
import { systemPrompt } from './prompt.js';
import { MONEY_TOOLS, SLOW_TOOLS, redactArgs, toolsFor } from './tools.js';

export type AgentEvent =
    | { type: 'text'; delta: string }
    | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; slow: boolean }
    | { type: 'guard'; id: string; tool: string; result: GuardResult }
    | { type: 'tool_result'; id: string; name: string; result: unknown }
    | {
        type: 'done';
        /** Messages produced this turn, to append to the caller's history. */
        messages: Message[];
        usage: Usage;
        timings: { firstTokenMs: number | null; totalMs: number };
        hops: number;
    };

export interface TurnOptions {
    model: ModelClient;
    executor: ToolExecutor;
    guard: FraudGuard;
    callerId: string;
    /** Caller's number in international format, when known. */
    callerNumber?: string;
    /** Conversation so far, without a system message: user, assistant and tool messages. */
    history: Message[];
    /** Caller's country: currency, networks, languages and scam patterns. Defaults to Nigeria. */
    country?: Country;
    profile?: string;
    signal?: AbortSignal;
    maxHops?: number;
}

function parseArgs(raw: string): Record<string, unknown> {
    try {
        const v = JSON.parse(raw || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
        return {};
    }
}

/**
 * True if the caller passed verify_pin since the last money tool actually went
 * through, so one PIN covers one payment, not the rest of the call.
 */
export function pinVerifiedForNextPayment(messages: Message[]): boolean {
    const names = new Map<string, string>();
    for (const m of messages) {
        if (m.role === 'assistant') for (const tc of m.tool_calls ?? []) if (tc.type === 'function') names.set(tc.id, tc.function.name);
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.role !== 'tool') continue;
        const name = names.get(m.tool_call_id);
        const result = parseArgs(typeof m.content === 'string' ? m.content : '');
        if (name === 'verify_pin') return result['verified'] === true;
        if (name && MONEY_TOOLS.has(name) && result['status'] === 'success') return false;
    }
    return false;
}

/** Length of the leading text made of finished sentences that already have more text after them. */
export function completedSentences(text: string): number {
    let cut = 0;
    for (const m of text.matchAll(/[.!?…]["'”’)]*\s+(?=\S)/g)) cut = m.index + m[0].length;
    return cut;
}

async function isKnownRecipient(executor: ToolExecutor, ctx: { callerId: string; country: Country }, recipient: unknown): Promise<boolean> {
    const r = String(recipient ?? '').trim().toLowerCase();
    if (!r || r === 'self') return true;
    try {
        const res = (await executor.execute('list_beneficiaries', {}, { callerId: ctx.callerId, country: ctx.country.code })) as {
            beneficiaries?: Array<{ nickname?: string; name?: string }>;
        };
        return (res.beneficiaries ?? []).some((b) => b.nickname?.toLowerCase() === r || b.name?.toLowerCase() === r);
    } catch {
        return false;
    }
}

/**
 * One caller turn: stream the model's reply, run any tools it asks for (money
 * tools go through the fraud check first), and loop until it has something to
 * say. Text deltas are yielded as they arrive so the call server can start
 * speaking on the first sentence.
 */
export async function* runTurn(opts: TurnOptions): AsyncGenerator<AgentEvent, void, void> {
    const { model, executor, guard, callerId, signal } = opts;
    const maxHops = opts.maxHops ?? 4;
    const country = opts.country ?? DEFAULT_COUNTRY;
    const tools = toolsFor(country);
    const started = Date.now();
    let firstTokenMs: number | null = null;
    const usage: Usage = { inputTokens: 0, outputTokens: 0, estimated: false };
    const produced: Message[] = [];
    const convo = (): Message[] => [...opts.history, ...produced];

    let spoken = '';
    let toolsRan = false;

    for (let hop = 1; hop <= maxHops; hop++) {
        const gen = model.stream([{ role: 'system', content: systemPrompt(country, opts.profile) }, ...convo()], tools, signal);
        let hopSpoken = '';
        // The newest sentence waits until the next one starts (the call server
        // speaks whole sentences anyway), so "I'll send it now." can be dropped
        // if the model turns out to be calling a tool instead.
        let held = '';
        const say = function* (text: string): Generator<AgentEvent, void, void> {
            if (firstTokenMs === null) firstTokenMs = Date.now() - started;
            // Text from an earlier hop ("One moment.") must not run into this one ("One moment.Done").
            if (!hopSpoken && spoken && !/\s$/.test(spoken) && !/^\s/.test(text)) text = ` ${text}`;
            hopSpoken += text;
            spoken += text;
            yield { type: 'text', delta: text };
        };

        let next = await gen.next();
        while (!next.done) {
            held += next.value;
            const cut = completedSentences(held);
            if (cut > 0) {
                yield* say(held.slice(0, cut));
                held = held.slice(cut);
            }
            next = await gen.next();
        }
        const assembled = next.value;
        usage.inputTokens += assembled.usage.inputTokens;
        usage.outputTokens += assembled.usage.outputTokens;
        usage.estimated ||= assembled.usage.estimated;

        if (assembled.toolCalls.length === 0) {
            if (held) yield* say(held);
            if (hopSpoken.trim()) produced.push({ role: 'assistant', content: hopSpoken.trim() });
            yield { type: 'done', messages: produced, usage, timings: { firstTokenMs, totalMs: Date.now() - started }, hops: hop };
            return;
        }

        // Before the first tool runs, a held sentence is an announcement ("I'll
        // send that now") that the fraud check may yet make untrue: drop it and
        // let the call server's filler cover the wait. After a tool has run, it
        // is usually a result ("I've sent it to Mum"), so it is kept.
        if (held && toolsRan) yield* say(held);
        toolsRan = true;
        produced.push({ role: 'assistant', content: hopSpoken.trim() || null, tool_calls: assembled.toolCalls });
        for (const call of assembled.toolCalls) {
            const result = yield* runTool(call, opts, convo());
            produced.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
    }

    const fallback = "Sorry, that took longer than expected. Could you say that again?";
    yield { type: 'text', delta: fallback };
    produced.push({ role: 'assistant', content: fallback });
    yield { type: 'done', messages: produced, usage, timings: { firstTokenMs, totalMs: Date.now() - started }, hops: maxHops };
}

async function* runTool(call: ToolCall, opts: TurnOptions, transcript: Message[]): AsyncGenerator<AgentEvent, unknown, void> {
    const { name } = call.function;
    const args = parseArgs(call.function.arguments);
    const country = opts.country ?? DEFAULT_COUNTRY;
    yield { type: 'tool_call', id: call.id, name, args: redactArgs(name, args), slow: SLOW_TOOLS.has(name) };

    if (MONEY_TOOLS.has(name)) {
        const verdict = await opts.guard.check({
            tool: name,
            args,
            transcript,
            knownRecipient: await isKnownRecipient(opts.executor, { callerId: opts.callerId, country }, args['recipient']),
            verified: pinVerifiedForNextPayment(transcript),
            country,
        });
        yield { type: 'guard', id: call.id, tool: name, result: verdict };
        if (verdict.decision !== 'allow') {
            const result = {
                status: verdict.decision === 'block' ? 'blocked' : 'needs_verification',
                reasons: verdict.reasons,
            };
            yield { type: 'tool_result', id: call.id, name, result };
            return result;
        }
    }

    let result: unknown;
    try {
        result = await opts.executor.execute(name, args, { callerId: opts.callerId, callerNumber: opts.callerNumber, country: country.code });
    } catch (err) {
        result = { error: err instanceof Error ? err.message : 'tool failed' };
    }
    yield { type: 'tool_result', id: call.id, name, result };
    return result;
}
