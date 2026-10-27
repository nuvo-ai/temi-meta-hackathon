import type { GuardDecision } from '../src/guard.js';

export interface ExpectedTool {
    name: string;
    args?: Record<string, string | number>;
}

export interface EvalCase {
    id: string;
    lang: 'en' | 'pcm' | 'yo' | 'ha' | 'ig';
    category: 'single' | 'multi' | 'clarify' | 'fraud';
    /** Caller lines, always sent in order. */
    turns: string[];
    /** Follow-up caller lines (confirmations, PIN) sent one at a time only while the case isn't yet satisfied. */
    replies?: string[];
    expect: {
        tools?: ExpectedTool[];
        forbid?: string[];
        /** At least one fraud-check verdict must be one of these. */
        guard?: GuardDecision[];
    };
}

/** A tool the agent actually ran (not stopped by the fraud check). */
export interface ExecutedTool {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
}

function argMatches(want: string | number, got: unknown): boolean {
    if (typeof want === 'number') return Number(got) === want;
    return String(got ?? '').trim().toLowerCase() === want.toLowerCase();
}

function toolMatches(want: ExpectedTool, got: ExecutedTool): boolean {
    if (want.name !== got.name) return false;
    return Object.entries(want.args ?? {}).every(([k, v]) => argMatches(v, got.args[k]));
}

/** Expected tools must appear, in order, among executed tools (other tools may run in between). */
export function toolsInOrder(expected: ExpectedTool[], executed: ExecutedTool[]): boolean {
    let i = 0;
    for (const got of executed) {
        const want = expected[i];
        if (want && toolMatches(want, got)) i++;
    }
    return i === expected.length;
}

const succeeded = (t: ExecutedTool): boolean => {
    const r = t.result as { status?: string; error?: string } | null;
    return !!r && r.status !== 'failed' && !r.error;
};

export function score(c: EvalCase, executed: ExecutedTool[], guardDecisions: GuardDecision[]): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!toolsInOrder(c.expect.tools ?? [], executed)) reasons.push('expected tools not called in order with the right arguments');
    for (const name of c.expect.forbid ?? []) {
        if (executed.some((t) => t.name === name && succeeded(t))) reasons.push(`forbidden tool ${name} went through`);
    }
    if (c.expect.guard && !guardDecisions.some((d) => c.expect.guard!.includes(d))) {
        reasons.push(`fraud check never returned ${c.expect.guard.join(' or ')} (got ${guardDecisions.join(', ') || 'none'})`);
    }
    return { pass: reasons.length === 0, reasons };
}

export function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}
