import { readdirSync, readFileSync } from 'node:fs';
import { percentile } from './score.js';

// Prints a before/after table in Markdown, ready to paste into the README.
// Before: Temi's previous production model, recorded on Oct 27 before the switch
// to Meta (evals/before/). After: every saved Muse Spark run since a cutoff.
//   npx tsx evals/compare.ts --since 2026-10-27T11:25
const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1]! : '1970';

interface Run {
    summary: { provider: string; model: string; ranAt: string; costNgnPerMinute: number };
    results: Array<{
        id: string;
        /** Missing on runs from before Kenya and Ghana were added: those were all Nigeria. */
        country?: string;
        lang: string;
        category: string;
        pass: boolean;
        firstWordPlainTurnMs?: number[];
        firstWordToolTurnMs?: number[];
        firstSoundMs?: number[];
        inputTokens: number;
        outputTokens: number;
        turnMs: number[];
        toolTurns?: number;
        spokeBeforeTool?: string[];
        guard: Array<{ decision: string; latencyMs: number; reasons: string[] }>;
        fraudOutcome?: string;
        error?: string;
    }>;
}

const load = (dir: URL) =>
    readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Run)
        .filter((r) => r.results.length > 1 && !r.results.some((x) => x.error));
const sides = {
    before: load(new URL('./before/', import.meta.url)),
    after: load(new URL('./results/', import.meta.url)).filter((r) => r.summary.provider === 'meta' && r.summary.ranAt >= since),
};
const runs = [...sides.before, ...sides.after];

const COUNTRY_NAMES: Record<string, string> = { NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana', TZ: 'Tanzania', UG: 'Uganda' };
const LANGS: Record<string, string> = {
    en: 'English', pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo',
    sw: 'Swahili', sheng: 'Sheng', tw: 'Twi', gpe: 'Ghanaian Pidgin', lg: 'Luganda',
};
const rate = (rs: Run[], keep: (c: Run['results'][number]) => boolean) => {
    const cs = rs.flatMap((r) => r.results).filter(keep);
    const n = cs.filter((c) => c.pass).length;
    return cs.length ? `${n}/${cs.length} (${Math.round((100 * n) / cs.length)}%)` : '-';
};
const ms = (v: number | null) => (v === null ? '-' : `${(v / 1000).toFixed(1)}s`);
const all = <K extends 'firstWordPlainTurnMs' | 'firstWordToolTurnMs' | 'firstSoundMs'>(rs: Run[], k: K) => rs.flatMap((r) => r.results.flatMap((c) => c[k] ?? []));
const guards = (rs: Run[]) => rs.flatMap((r) => r.results.flatMap((c) => c.guard));
const perTurn = (rs: Run[], k: 'inputTokens' | 'outputTokens') => {
    const turns = rs.flatMap((r) => r.results).reduce((n, c) => n + c.turnMs.length, 0);
    return turns ? Math.round(rs.flatMap((r) => r.results).reduce((n, c) => n + c[k], 0) / turns) : 0;
};

const rows: Array<[string, (rs: Run[]) => string]> = [
    ['Runs', (rs) => String(rs.length)],
    ['All cases', (rs) => rate(rs, () => true)],
    ...Object.entries(COUNTRY_NAMES).map(([k, name]) => [name, (rs: Run[]) => rate(rs, (c) => (c.country ?? 'NG') === k)] as [string, (rs: Run[]) => string]),
    ['Multi-step requests', (rs) => rate(rs, (c) => c.category === 'multi')],
    ...Object.entries(LANGS).map(([k, name]) => [`  ${name}`, (rs: Run[]) => rate(rs, (c) => c.lang === k)] as [string, (rs: Run[]) => string]),
    ['Scam cases stopped', (rs) => rate(rs, (c) => c.category === 'fraud')],
    ['First word, plain turn (p50 / p95)', (rs) => `${ms(percentile(all(rs, 'firstWordPlainTurnMs'), 50))} / ${ms(percentile(all(rs, 'firstWordPlainTurnMs'), 95))}`],
    ['First word, turn that takes an action (p50 / p95)', (rs) => `${ms(percentile(all(rs, 'firstWordToolTurnMs'), 50))} / ${ms(percentile(all(rs, 'firstWordToolTurnMs'), 95))}`],
    ['Spoke before the action ran', (rs) => {
        const cs = rs.flatMap((r) => r.results).filter((c) => c.toolTurns !== undefined);
        return cs.length ? `${cs.reduce((n, c) => n + (c.spokeBeforeTool?.length ?? 0), 0)}/${cs.reduce((n, c) => n + (c.toolTurns ?? 0), 0)} action turns` : '-';
    }],
    ['First sound on any turn, words or filler (p50 / p95)', (rs) => {
        const v = all(rs, 'firstSoundMs');
        return v.length ? `${ms(percentile(v, 50))} / ${ms(percentile(v, 95))}` : '-';
    }],
    ['Fraud check (p50 / p95)', (rs) => `${ms(percentile(guards(rs).map((g) => g.latencyMs), 50))} / ${ms(percentile(guards(rs).map((g) => g.latencyMs), 95))}`],
    ['Fraud check timeouts', (rs) => `${guards(rs).filter((g) => g.reasons.some((x) => x.startsWith('fraud model unavailable'))).length}/${guards(rs).length}`],
    ['Tokens per turn (in / out)', (rs) => `${perTurn(rs, 'inputTokens').toLocaleString()} / ${perTurn(rs, 'outputTokens').toLocaleString()}`],
    ['LLM cost per call minute', (rs) => {
        const c = rs.map((r) => r.summary.costNgnPerMinute).filter((v) => v > 0);
        return c.length ? `₦${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(2)}` : 'price not set';
    }],
];

const model = (rs: Run[]) => rs[0]?.summary.model ?? '-';
console.log(`| | Before: ${model(sides.before)} | After: ${model(sides.after)} |`);
console.log('|---|---|---|');
for (const [label, f] of rows) console.log(`| ${label} | ${f(sides.before)} | ${f(sides.after)} |`);

// Per-case pass counts, to spot which requests the old model kept missing.
console.log('\n| Case | Before | After |\n|---|---|---|');
const ids = [...new Set(runs.flatMap((r) => r.results.map((c) => c.id)))];
for (const id of ids) {
    const count = (rs: Run[]) => {
        const cs = rs.flatMap((r) => r.results).filter((c) => c.id === id);
        return `${cs.filter((c) => c.pass).length}/${cs.length}`;
    };
    console.log(`| ${id} | ${count(sides.before)} | ${count(sides.after)} |`);
}
