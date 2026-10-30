import { readFileSync, writeFileSync } from 'node:fs';
import { runTurn } from '../src/agent.js';
import { config, guardProviderConfig, providerConfig } from '../src/config.js';
import { COUNTRIES, type CountryCode } from '../src/countries.js';
import { MockBank } from '../src/executors/mock-bank.js';
import type { GuardDecision } from '../src/guard.js';
import type { Message } from '../src/model.js';
import { createRuntime } from '../src/runtime.js';
import { judgeAnswer, judgeLanguage } from './judge.js';
import { fraudOutcome, percentile, score, spokenProblems, type EvalCase, type ExecutedTool, type Outcome } from './score.js';

// Usage:
//   npm run eval
//   npm run eval -- --only pcm-multi-send-data
//   npm run eval -- --country KE
//   npm run eval -- --category general
const args = process.argv.slice(2);
const provider = 'meta';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const onlyCountry = args.includes('--country') ? args[args.indexOf('--country') + 1]?.toUpperCase() : undefined;
const onlyCategory = args.includes('--category') ? args[args.indexOf('--category') + 1] : undefined;
const turnsPerMinute = Number(process.env['TURNS_PER_MINUTE']) || 4;

const cases = (JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as EvalCase[]).filter(
    (c) => (!only || c.id === only) && (!onlyCountry || (c.country ?? 'NG') === onlyCountry) && (!onlyCategory || c.category === onlyCategory),
);
const pricing = providerConfig();

interface CaseResult {
    id: string;
    country: CountryCode;
    lang: string;
    category: string;
    pass: boolean;
    reasons: string[];
    firstTokenMs: number[];
    firstWordPlainTurnMs: number[];
    firstWordToolTurnMs: number[];
    /** When the caller first hears anything on a turn: Temi's words, or the call server's filler as a slow tool starts. */
    firstSoundMs: number[];
    turnMs: number[];
    /** Turns that ran a tool, and how many of those spoke before the first tool ran ("I'll send it now…"). */
    toolTurns: number;
    spokeBeforeTool: string[];
    inputTokens: number;
    outputTokens: number;
    tokensEstimated: boolean;
    transcript: Array<{ role: string; text: string }>;
    tools: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
    guard: Array<{ decision: GuardDecision; reasons: string[]; latencyMs: number }>;
    fraudOutcome?: ReturnType<typeof fraudOutcome>;
    /** General questions: the model judge's verdict on Temi's answer. */
    judge?: { pass: boolean; reason: string };
    /** Non-English cases: did every Temi reply stay in the caller's language? Reported, not part of pass/fail. */
    language?: { pass: boolean; reason: string };
    error?: string;
}

async function runCase(c: EvalCase): Promise<CaseResult> {
    // Fresh bank per case so balances and history don't leak between cases.
    const runtime = createRuntime(new MockBank());
    const country = COUNTRIES[c.country ?? 'NG'];
    const history: Message[] = [];
    const executed: ExecutedTool[] = [];
    const guard: CaseResult['guard'] = [];
    const out: CaseResult = {
        id: c.id, country: country.code, lang: c.lang, category: c.category, pass: false, reasons: [],
        firstTokenMs: [], firstWordPlainTurnMs: [], firstWordToolTurnMs: [], firstSoundMs: [], turnMs: [], toolTurns: 0, spokeBeforeTool: [], inputTokens: 0, outputTokens: 0, tokensEstimated: false,
        transcript: [], tools: [], guard,
    };

    const say = async (line: string) => {
        history.push({ role: 'user', content: line });
        out.transcript.push({ role: 'caller', text: line });
        let spoken = '';
        let beforeTool: string | null = null;
        const turnStarted = Date.now();
        let firstSound: number | null = null;
        const toolsBefore = out.tools.length;
        const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
        for await (const ev of runTurn({ ...runtime, callerId: `eval-${c.id}`, history, country })) {
            if (ev.type === 'text' || (ev.type === 'tool_call' && ev.slow)) firstSound ??= Date.now() - turnStarted;
            if (ev.type === 'text') spoken += ev.delta;
            else if (ev.type === 'tool_call') {
                beforeTool ??= spoken;
                pending.set(ev.id, { name: ev.name, args: ev.args });
            }
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
                if (ev.timings.firstTokenMs !== null) {
                    out.firstTokenMs.push(ev.timings.firstTokenMs);
                    // Tool turns include the bank round trip, which the call server covers with a filler.
                    (out.tools.length > toolsBefore ? out.firstWordToolTurnMs : out.firstWordPlainTurnMs).push(ev.timings.firstTokenMs);
                }
                out.turnMs.push(ev.timings.totalMs);
                out.inputTokens += ev.usage.inputTokens;
                out.outputTokens += ev.usage.outputTokens;
                out.tokensEstimated ||= ev.usage.estimated;
            }
        }
        out.transcript.push({ role: 'temi', text: spoken.trim() });
        if (firstSound !== null) out.firstSoundMs.push(firstSound);
        if (beforeTool !== null) {
            out.toolTurns++;
            if (beforeTool.trim()) out.spokeBeforeTool.push(beforeTool.trim());
        }
    };

    const outcome = (): Outcome => ({ executed, attempted: out.tools.map((t) => t.name), guardDecisions: guard.map((g) => g.decision) });
    try {
        for (const line of c.turns) await say(line);
        // Like a real caller, give the mock bank's PIN whenever Temi asks for it
        // (up to twice), otherwise send the case's next scripted reply.
        const replies = [...(c.replies ?? [])];
        let pinsGiven = 0;
        while (replies.length > 0) {
            if (score(c, outcome()).pass && executed.length + guard.length > 0) break;
            const lastTemi = out.transcript.at(-1)?.text ?? '';
            if (/\bPIN\b/i.test(lastTemi) && pinsGiven < 2) {
                pinsGiven++;
                await say('1234');
            } else {
                await say(replies.shift()!);
            }
        }
        Object.assign(out, score(c, outcome()));
        if (c.category === 'fraud') out.fraudOutcome = fraudOutcome(outcome());
        if (c.expect.answer) {
            const answer = out.transcript.at(-1)?.text ?? '';
            for (const p of spokenProblems(answer)) out.reasons.push(`answer: ${p}`);
            if (c.category === 'general' && out.tools.length > 0) out.reasons.push(`answered a general question with tools: ${out.tools.map((t) => t.name).join(', ')}`);
            out.judge = await judgeAnswer({ question: c.turns.at(-1)!, answer, lang: c.lang, rubric: c.expect.answer });
            if (!out.judge.pass) out.reasons.push(`judge: ${out.judge.reason}`);
            out.pass = out.reasons.length === 0;
        }
        if (c.lang !== 'en') {
            const temi = out.transcript.filter((t) => t.role === 'temi' && t.text).map((t) => t.text);
            if (temi.length) out.language = await judgeLanguage({ lang: c.lang, caller: out.transcript.filter((t) => t.role === 'caller').map((t) => t.text), temi });
        }
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
    console.log(`${r.pass ? '✓' : '✗'} ${r.id}${r.fraudOutcome ? ` [${r.fraudOutcome}]` : ''}${r.pass ? '' : `  — ${r.reasons.join('; ')}`}`);
    if (r.judge) console.log(`    Temi: ${r.transcript.at(-1)?.text}`);
    if (r.language && !r.language.pass) console.log(`    language slip: ${r.language.reason}`);
    // A bad key or no network fails every case the same way; stop instead of reporting 0%.
    if (r.error && /\b(401|403)\b/.test(r.error)) {
        console.error(`\nStopping: ${provider} rejected the API key. Check it in .env.`);
        process.exit(1);
    }
    if (r.error && /connection error/i.test(r.error)) {
        console.error(`\nStopping: couldn't reach ${provider}. Check the network and try again.`);
        process.exit(1);
    }
}

const group = (key: 'category' | 'lang' | 'country') => {
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
    byCountry: group('country'),
    byCategory: group('category'),
    byLanguage: group('lang'),
    firstTokenP50: fmt(percentile(firstTokens, 50)),
    firstTokenP95: fmt(percentile(firstTokens, 95)),
    firstWordNoToolP50: fmt(percentile(results.flatMap((r) => r.firstWordPlainTurnMs), 50)),
    firstWordNoToolP95: fmt(percentile(results.flatMap((r) => r.firstWordPlainTurnMs), 95)),
    firstWordToolTurnP50: fmt(percentile(results.flatMap((r) => r.firstWordToolTurnMs), 50)),
    firstSoundP50: fmt(percentile(results.flatMap((r) => r.firstSoundMs), 50)),
    firstSoundP95: fmt(percentile(results.flatMap((r) => r.firstSoundMs), 95)),
    reasoningEffort: pricing.extraBody['reasoning_effort'] ?? null,
    guardEffort: guardProviderConfig().extraBody['reasoning_effort'] ?? null,
    fraudCheckP50: fmt(percentile(results.flatMap((r) => r.guard.map((g) => g.latencyMs)), 50)),
    fraudCheckP95: fmt(percentile(results.flatMap((r) => r.guard.map((g) => g.latencyMs)), 95)),
    // Fraud model timed out or errored, so the payment fell back to a PIN.
    fraudCheckUnavailable: `${results.flatMap((r) => r.guard).filter((g) => g.reasons.some((x) => x.startsWith('fraud model unavailable'))).length}/${results.flatMap((r) => r.guard).length}`,
    stayedInLanguage: `${results.filter((r) => r.language?.pass).length}/${results.filter((r) => r.language).length} non-English cases`,
    spokeBeforeTool: `${results.reduce((n, r) => n + r.spokeBeforeTool.length, 0)}/${results.reduce((n, r) => n + r.toolTurns, 0)} tool turns`,
    fraudOutcomes: Object.fromEntries(results.filter((r) => r.fraudOutcome).map((r) => [r.id, r.fraudOutcome])),
    tokens: { input: inTok, output: outTok, turns, perTurnIn: turns ? Math.round(inTok / turns) : 0, perTurnOut: turns ? Math.round(outTok / turns) : 0, estimated: results.some((r) => r.tokensEstimated) },
    costNgnPerTurn: Number(ngnPerTurn.toFixed(3)),
    costNgnPerMinute: Number((ngnPerTurn * turnsPerMinute).toFixed(2)),
    costAssumptions: `${turnsPerMinute} turns/min, $1 = ₦${config.usdToNgn}, $${pricing.priceInPerM}/$${pricing.priceOutPerM} per 1M in/out tokens; fraud-check tokens not included`,
};

console.log('\n' + JSON.stringify(summary, null, 2));
const file = new URL(`./results/${provider}-${summary.ranAt.replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
console.log(`\nFull transcripts: ${file.pathname}`);
