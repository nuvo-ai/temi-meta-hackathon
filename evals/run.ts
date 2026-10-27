import { readFileSync, writeFileSync } from 'node:fs';
import { runTurn } from '../src/agent.js';
import { config, providerConfig, type ProviderName } from '../src/config.js';
import { MockBank } from '../src/executors/mock-bank.js';
import type { GuardDecision } from '../src/guard.js';
import type { Message } from '../src/model.js';
import { createRuntime } from '../src/runtime.js';
import { percentile, score, type EvalCase, type ExecutedTool } from './score.js';

// Usage:
//   npm run eval -- meta
//   npm run eval -- baseline
//   npm run eval -- meta --only pcm-multi-send-data
const args = process.argv.slice(2);
const provider: ProviderName = args[0] === 'baseline' ? 'baseline' : 'meta';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const turnsPerMinute = Number(process.env['TURNS_PER_MINUTE']) || 4;

const cases = (JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as EvalCase[]).filter(
    (c) => !only || c.id === only,
);
const pricing = providerConfig(provider);

interface CaseResult {
    id: string;
    lang: string;
    category: string;
    pass: boolean;
    reasons: string[];
    firstTokenMs: number[];
    turnMs: number[];
    inputTokens: number;
    outputTokens: number;
    tokensEstimated: boolean;
    transcript: Array<{ role: string; text: string }>;
    tools: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
    guard: Array<{ decision: GuardDecision; reasons: string[]; latencyMs: number }>;
    error?: string;
}

async function runCase(c: EvalCase): Promise<CaseResult> {
    // Fresh bank per case so balances and history don't leak between cases.
    const runtime = createRuntime(provider, new MockBank());
    const history: Message[] = [];
    const executed: ExecutedTool[] = [];
    const guard: CaseResult['guard'] = [];
    const out: CaseResult = {
        id: c.id, lang: c.lang, category: c.category, pass: false, reasons: [],
        firstTokenMs: [], turnMs: [], inputTokens: 0, outputTokens: 0, tokensEstimated: false,
        transcript: [], tools: [], guard,
    };

    const say = async (line: string) => {
        history.push({ role: 'user', content: line });
        out.transcript.push({ role: 'caller', text: line });
        let spoken = '';
        const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
        for await (const ev of runTurn({ ...runtime, callerId: `eval-${c.id}`, history })) {
            if (ev.type === 'text') spoken += ev.delta;
            else if (ev.type === 'tool_call') pending.set(ev.id, { name: ev.name, args: ev.args });
            else if (ev.type === 'guard') guard.push({ decision: ev.result.decision, reasons: ev.result.reasons, latencyMs: ev.result.latencyMs });
            else if (ev.type === 'tool_result') {
                const call = pending.get(ev.id);
                const r = ev.result as { status?: string } | null;
                const stopped = r?.status === 'blocked' || r?.status === 'needs_verification';
                if (call) {
                    out.tools.push({ ...call, result: ev.result });
                    if (!stopped) executed.push({ ...call, result: ev.result });
                }
            } else if (ev.type === 'done') {
                history.push(...ev.messages);
                if (ev.timings.firstTokenMs !== null) out.firstTokenMs.push(ev.timings.firstTokenMs);
                out.turnMs.push(ev.timings.totalMs);
                out.inputTokens += ev.usage.inputTokens;
                out.outputTokens += ev.usage.outputTokens;
                out.tokensEstimated ||= ev.usage.estimated;
            }
        }
        out.transcript.push({ role: 'temi', text: spoken.trim() });
    };

    try {
        for (const line of c.turns) await say(line);
        for (const reply of c.replies ?? []) {
            if (score(c, executed, guard.map((g) => g.decision)).pass) break;
            await say(reply);
        }
        Object.assign(out, score(c, executed, guard.map((g) => g.decision)));
    } catch (err) {
        out.error = err instanceof Error ? err.message : String(err);
        out.reasons.push(`error: ${out.error}`);
    }
    return out;
}

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`);
const fmt = (v: number | null) => (v === null ? '-' : `${v}ms`);

console.log(`Running ${cases.length} cases on ${provider} (${pricing.model})…\n`);
const results: CaseResult[] = [];
for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    console.log(`${r.pass ? '✓' : '✗'} ${r.id}${r.pass ? '' : `  — ${r.reasons.join('; ')}`}`);
}

const group = (key: 'category' | 'lang') => {
    const m = new Map<string, { pass: number; total: number }>();
    for (const r of results) {
        const g = m.get(r[key]) ?? { pass: 0, total: 0 };
        g.total++;
        if (r.pass) g.pass++;
        m.set(r[key], g);
    }
    return Object.fromEntries([...m].map(([k, v]) => [k, `${v.pass}/${v.total} (${pct(v.pass, v.total)})`]));
};

const firstTokens = results.flatMap((r) => r.firstTokenMs);
const turns = results.reduce((n, r) => n + r.turnMs.length, 0);
const inTok = results.reduce((n, r) => n + r.inputTokens, 0);
const outTok = results.reduce((n, r) => n + r.outputTokens, 0);
const usd = (inTok * pricing.priceInPerM + outTok * pricing.priceOutPerM) / 1_000_000;
const ngnPerTurn = turns ? (usd * config.usdToNgn) / turns : 0;
const passed = results.filter((r) => r.pass).length;

const summary = {
    provider,
    model: pricing.model,
    ranAt: new Date().toISOString(),
    pass: `${passed}/${results.length} (${pct(passed, results.length)})`,
    byCategory: group('category'),
    byLanguage: group('lang'),
    firstTokenP50: fmt(percentile(firstTokens, 50)),
    firstTokenP95: fmt(percentile(firstTokens, 95)),
    fraudCheckP50: fmt(percentile(results.flatMap((r) => r.guard.map((g) => g.latencyMs)), 50)),
    tokens: { input: inTok, output: outTok, estimated: results.some((r) => r.tokensEstimated) },
    costNgnPerTurn: Number(ngnPerTurn.toFixed(3)),
    costNgnPerMinute: Number((ngnPerTurn * turnsPerMinute).toFixed(2)),
    costAssumptions: `${turnsPerMinute} turns/min, $1 = ₦${config.usdToNgn}, $${pricing.priceInPerM}/$${pricing.priceOutPerM} per 1M in/out tokens; fraud-check tokens not included`,
};

console.log('\n' + JSON.stringify(summary, null, 2));
const file = new URL(`./results/${provider}-${summary.ranAt.replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
console.log(`\nFull transcripts: ${file.pathname}`);
