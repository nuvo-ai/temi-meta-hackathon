import { readFileSync } from 'node:fs';
import { guardProviderConfig } from '../src/config.js';
import { COUNTRIES, type CountryCode } from '../src/countries.js';
import { guardMessages, parseVerdict, type GuardInput } from '../src/guard.js';
import { MetaClient, type Message } from '../src/model.js';
import { percentile } from './score.js';

// Times the fraud model on its own, with no timeout, over the money actions
// in saved eval results. Shows how long each verdict really takes and how many
// tokens it spends reasoning.
//   npx tsx evals/guard-bench.ts evals/results/<file>.json [--effort low] [--repeat 2]
const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.json'));
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repeat = Number(opt('--repeat')) || 1;

const cfg = guardProviderConfig();
if (opt('--effort')) cfg.extraBody = { reasoning_effort: opt('--effort') };
const model = new MetaClient(cfg);

interface Saved {
    results: Array<{
        id: string;
        country?: CountryCode;
        transcript: Array<{ role: string; text: string }>;
        tools: Array<{ name: string; args: Record<string, unknown> }>;
    }>;
}

interface LabeledCase {
    id: string;
    country?: CountryCode;
    kind: 'scam' | 'legit';
    tool: string;
    args: Record<string, unknown>;
    knownRecipient: boolean;
    transcript: Array<[string, string]>;
}

const inputs: Array<{ label: string; input: GuardInput; kind?: LabeledCase['kind'] }> = [];
// No results files given: use the hand-labeled scam and legit conversations.
if (files.length === 0) {
    const labeled = JSON.parse(readFileSync(new URL('./guard-cases.json', import.meta.url), 'utf8')) as LabeledCase[];
    for (const c of labeled) {
        const transcript: Message[] = c.transcript.map(([who, text]) => ({ role: who === 'caller' ? 'user' : 'assistant', content: text }));
        inputs.push({ label: `${c.kind}:${c.id}`, kind: c.kind, input: { tool: c.tool, args: c.args, transcript, knownRecipient: c.knownRecipient, verified: false, country: COUNTRIES[c.country ?? 'NG'] } });
    }
}
for (const file of files) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
    const tag = file.split('/').pop()!.split('-')[0];
    for (const r of saved.results) {
        const transcript: Message[] = r.transcript.map((t) => ({ role: t.role === 'caller' ? 'user' : 'assistant', content: t.text }));
        for (const t of r.tools.filter((t) => ['send_money', 'buy_airtime', 'buy_data'].includes(t.name))) {
            inputs.push({ label: `${tag}:${r.id}:${t.name}`, input: { tool: t.name, args: t.args, transcript, knownRecipient: true, verified: false, country: COUNTRIES[r.country ?? 'NG'] } });
        }
    }
}

console.log(`${inputs.length} money actions × ${repeat} on ${cfg.model} (effort ${String(cfg.extraBody['reasoning_effort'])})\n`);
const rows: Array<{ label: string; kind?: string; ms: number; reasoning?: number; out: number; decision: string }> = [];
for (let i = 0; i < repeat; i++) {
    for (const { label, input, kind } of inputs) {
        const started = Date.now();
        try {
            const { content, usage } = await model.complete(guardMessages(input));
            const row = { label, kind, ms: Date.now() - started, reasoning: usage.reasoningTokens, out: usage.outputTokens, decision: parseVerdict(content)?.decision ?? 'unparsed' };
            rows.push(row);
            console.log(`${String(row.ms).padStart(6)}ms  out ${String(row.out).padStart(5)}  reasoning ${String(row.reasoning ?? '-').padStart(5)}  ${row.decision.padEnd(8)} ${label}`);
        } catch (err) {
            console.log(`  error ${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

const groups = new Map<string, number[]>();
for (const r of rows) {
    const tag = r.label.split(':')[0]!;
    groups.set(tag, [...(groups.get(tag) ?? []), r.ms]);
}
console.log();
// Model verdict alone, before rules. A scam is caught by block or step_up;
// a legit payment that gets blocked is a false alarm, a step_up is friction.
const scams = rows.filter((r) => r.kind === 'scam');
const legit = rows.filter((r) => r.kind === 'legit');
if (scams.length + legit.length > 0) {
    console.log(`scams caught ${scams.filter((r) => r.decision !== 'allow').length}/${scams.length}, blocked outright ${scams.filter((r) => r.decision === 'block').length}/${scams.length}`);
    console.log(`legit allowed ${legit.filter((r) => r.decision === 'allow').length}/${legit.length}, asked for PIN ${legit.filter((r) => r.decision === 'step_up').length}, wrongly blocked ${legit.filter((r) => r.decision === 'block').length}`);
}
for (const [tag, ms] of groups) console.log(`${tag}: p50 ${percentile(ms, 50)}ms  p95 ${percentile(ms, 95)}ms  max ${Math.max(...ms)}ms  over 4s: ${ms.filter((m) => m > 4000).length}/${ms.length}`);
