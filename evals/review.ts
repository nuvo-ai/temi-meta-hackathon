import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Turns an eval run into one sheet per language for native speakers to mark:
//   npx tsx evals/review.ts                      # latest run
//   npx tsx evals/review.ts evals/results/<run>.json
// Writes evals/review/<lang>.csv. Open in Google Sheets or Excel, fill in the
// last three columns, and send it back; fixes become new eval cases.

const LANGUAGE: Record<string, string> = {
    pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo', sw: 'Swahili',
    sheng: 'Sheng', tw: 'Twi', gpe: 'Ghanaian Pidgin', lg: 'Luganda',
};

const dir = new URL('./results/', import.meta.url);
const file = process.argv[2] ?? new URL(readdirSync(dir).filter((f) => f.startsWith('meta-')).sort().at(-1)!, dir).pathname;
const { results } = JSON.parse(readFileSync(file, 'utf8')) as {
    results: Array<{ id: string; country: string; lang: string; transcript: Array<{ role: string; text: string }> }>;
};

const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const out = new URL('./review/', import.meta.url);
mkdirSync(out, { recursive: true });

const byLang = new Map<string, string[]>();
for (const r of results) {
    if (!LANGUAGE[r.lang]) continue;
    const rows = byLang.get(r.lang) ?? [];
    r.transcript.forEach((t, i) => {
        if (t.role !== 'temi' || !t.text) return;
        const caller = r.transcript[i - 1]?.role === 'caller' ? r.transcript[i - 1]!.text : '';
        rows.push([r.id, r.country, caller, t.text, '', '', ''].map(cell).join(','));
    });
    byLang.set(r.lang, rows);
}

const header = ['case', 'country', 'caller said', 'Temi said', 'natural? (yes/no)', 'meaning correct? (yes/no)', 'how a native speaker would say it'].map(cell).join(',');
for (const [lang, rows] of byLang) {
    writeFileSync(new URL(`${lang}.csv`, out), [header, ...rows].join('\n') + '\n');
    console.log(`${LANGUAGE[lang]}: ${rows.length} lines → evals/review/${lang}.csv`);
}
