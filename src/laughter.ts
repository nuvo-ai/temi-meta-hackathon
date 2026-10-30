import type { Message } from './model.js';

/**
 * Temi can laugh. Muse Spark marks the moment with [chuckle] (small and warm)
 * or [laugh] (something genuinely funny); the phone line plays a recorded
 * laugh there. The model decides *when*; this gate decides whether it's
 * allowed, in code:
 *
 * - at most MAX_LAUGHS_PER_CALL in a call, and one per reply;
 * - never two replies in a row;
 * - never in a turn where money was stopped or needs checking (a blocked
 *   payment, a fraud step-up, a PIN request, a refused memory). Laughing at
 *   someone who is being scammed is the worst thing a voice agent can do.
 *
 * Any other stage direction the model writes ("[smiles]") is dropped so the
 * voice never reads it out.
 */

export type LaughKind = 'chuckle' | 'laugh';

export const MAX_LAUGHS_PER_CALL = 2;

const MARKER = /\[(chuckle|laugh)\]/gi;
const STAGE_DIRECTION = /\[[a-z][a-z\s-]{0,20}\]/gi;
/** Tool results that mean the moment is serious. */
const SERIOUS_STATUSES = new Set(['blocked', 'needs_verification', 'refused']);

const textOf = (m: Message): string => (m.role === 'assistant' && typeof m.content === 'string' ? m.content : '');

export function countLaughs(text: string): number {
    return text.match(MARKER)?.length ?? 0;
}

export class LaughGate {
    private remaining: number;
    private laughedThisTurn = false;
    private serious = false;

    constructor(history: Message[]) {
        const replies = history.filter((m) => m.role === 'assistant' && textOf(m));
        const sofar = replies.reduce((n, m) => n + countLaughs(textOf(m)), 0);
        const lastLaughed = countLaughs(textOf(replies.at(-1) ?? { role: 'assistant', content: '' })) > 0;
        this.remaining = lastLaughed ? 0 : Math.max(0, MAX_LAUGHS_PER_CALL - sofar);
    }

    /** Call with each tool result; a stopped or unverified action makes the rest of the turn serious. */
    noteToolResult(result: unknown): void {
        const status = (result as { status?: string } | null)?.status;
        if (status && SERIOUS_STATUSES.has(status)) this.serious = true;
    }

    /** Keeps an allowed laugh marker in `text` and removes the rest. */
    filter(text: string): string {
        const out = text
            .replace(MARKER, (marker) => {
                if (this.serious || this.laughedThisTurn || this.remaining === 0) return '';
                this.laughedThisTurn = true;
                this.remaining--;
                return marker.toLowerCase();
            })
            .replace(STAGE_DIRECTION, (tag) => (/^\[(chuckle|laugh)\]$/.test(tag) ? tag : ''));
        return out === text ? text : out.replace(/ {2,}/g, ' ').replace(/^ +/, '');
    }
}

/** Splits a reply into speech and laughs, in order, for the phone line. */
export function splitLaughs(text: string): Array<{ say: string } | { laugh: LaughKind }> {
    const parts: Array<{ say: string } | { laugh: LaughKind }> = [];
    let last = 0;
    for (const m of text.matchAll(MARKER)) {
        const before = text.slice(last, m.index).trim();
        if (before) parts.push({ say: before });
        parts.push({ laugh: m[1]!.toLowerCase() as LaughKind });
        last = m.index! + m[0].length;
    }
    const rest = text.slice(last).trim();
    if (rest) parts.push({ say: rest });
    return parts;
}

/** The reply as plain words, without laugh markers (for judges, logs and text channels). */
export function withoutLaughs(text: string): string {
    return text.replace(MARKER, '').replace(/ {2,}/g, ' ').trim();
}
