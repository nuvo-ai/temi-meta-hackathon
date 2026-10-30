import type { Message } from './model.js';

/**
 * Guards on what reaches the caller's ear and what the caller must have heard.
 */

/**
 * Muse Spark occasionally says its own plan out loud ("We need to retry send
 * after PIN."). Sentences that talk about tools, retries or statuses are notes
 * to itself, never meant for the caller, so they're dropped before speaking.
 */
const INTERNAL_NOTE =
    /\b(retry|retrying|tool|tools|function call|verify_pin|send_money|buy_airtime|buy_data|get_balance|list_\w+|recent_transactions|set_reminder|cancel_reminder|needs_verification|needs_readback|step_up|my instructions|system prompt|next turn|proceeding silently|request (?:is )?still pending)\b/i;

export function withoutInternalNotes(text: string): string {
    // Keep the spacing around kept sentences; split after sentence ends.
    const parts = text.split(/(?<=[.!?…])(\s+)/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = parts[i] ?? '';
        if (INTERNAL_NOTE.test(sentence)) continue;
        kept.push(sentence + (parts[i + 1] ?? ''));
    }
    return kept.join('');
}

/**
 * PINs the caller has said on this call: a 4–6 digit number in a line that
 * mentions a PIN, or any line given to verify_pin. Temi must never say these
 * back, whatever the model writes.
 */
export function pinsSaid(history: Message[]): string[] {
    const pins = new Set<string>();
    for (const [i, m] of history.entries()) {
        if (m.role === 'assistant' && m.tool_calls) {
            for (const call of m.tool_calls) {
                if (call.function.name !== 'verify_pin') continue;
                const pin = String((JSON.parse(call.function.arguments || '{}') as { pin?: unknown }).pin ?? '');
                if (/^\d{4,6}$/.test(pin)) pins.add(pin);
            }
        }
        if (m.role !== 'user' || typeof m.content !== 'string') continue;
        const askedForPin = /\bpin\b/i.test(m.content) || /\bpin\b/i.test(String(history[i - 1]?.content ?? ''));
        if (askedForPin) for (const n of m.content.match(/\b\d{4,6}\b/g) ?? []) pins.add(n);
    }
    return [...pins];
}

/** Drops any sentence that would say one of these PINs aloud. */
export function withoutPins(text: string, pins: string[]): string {
    if (pins.length === 0) return text;
    const parts = text.split(/(?<=[.!?…])(\s+)/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = parts[i] ?? '';
        const digits = sentence.replace(/(\d)[\s-](?=\d)/g, '$1');
        if (pins.some((pin) => new RegExp(`(^|\\D)${pin}(\\D|$)`).test(digits))) continue;
        kept.push(sentence + (parts[i + 1] ?? ''));
    }
    return kept.join('');
}

/** Digits only, so "200,000", "200 000" and "200000" all compare equal. */
const digitsIn = (text: string): string[] => (text.replace(/(\d)[,\s.](?=\d{3}\b)/g, '$1').match(/\d+/g) ?? []);

/**
 * Whether Temi said this amount to the caller in digits recently, so the yes
 * they gave was to the exact number about to be sent. Used where spoken
 * numbers are easy to get wrong (Luganda's "emitwalo ebiri" is 20,000, and the
 * model once sent 200,000).
 */
export function amountReadBackInDigits(amount: number, transcript: Message[], lookback = 6): boolean {
    const recent = transcript
        .filter((m) => m.role === 'assistant' && typeof m.content === 'string')
        .slice(-lookback)
        .map((m) => m.content as string);
    return recent.some((text) => digitsIn(text).includes(String(Math.round(amount))));
}
