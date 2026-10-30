import { providerConfig } from '../src/config.js';
import { MetaClient } from '../src/model.js';

const LANGUAGE: Record<string, string> = {
    en: 'English', pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo', sw: 'Swahili',
    sheng: 'Sheng (Kenyan Swahili-English slang)', tw: 'Twi', gpe: 'Ghanaian Pidgin', lg: 'Luganda',
};

// The judge isn't on a live call, so it can think harder than the conversation model.
const cfg = providerConfig();
cfg.extraBody = { reasoning_effort: process.env['JUDGE_REASONING_EFFORT'] || 'low' };
const model = new MetaClient(cfg);

export interface Verdict {
    pass: boolean;
    reason: string;
}

/** Muse Spark grades one spoken answer to a general question against the case's rubric. */
export async function judgeAnswer(input: { question: string; answer: string; lang: string; rubric: string }): Promise<Verdict> {
    const language = LANGUAGE[input.lang] ?? input.lang;
    const { content } = await model.complete([
        {
            role: 'system',
            content: `You grade answers from Temi, a voice assistant people reach by a normal phone call. The answer is spoken aloud, so short is good.

Pass only if all of these hold:
1. It does what the rubric asks.
2. It is in ${language}, the caller's language. Mixing in a few English words the way speakers naturally do is fine; answering mostly in another language is not.
3. Nothing in it is false, and it doesn't state made-up specifics (rates, dates, names, laws) as fact.
4. A message the caller asked for is said out in full, not just described.

Reply with JSON only: {"pass": true or false, "reason": "one short sentence"}`,
        },
        { role: 'user', content: `Rubric: ${input.rubric}\n\nCaller said: ${input.question}\n\nTemi answered: ${input.answer}` },
    ]);
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    try {
        const v = JSON.parse(json ?? '') as Partial<Verdict>;
        return { pass: v.pass === true, reason: String(v.reason ?? '') };
    } catch {
        return { pass: false, reason: `judge reply wasn't JSON: ${content.slice(0, 120)}` };
    }
}
