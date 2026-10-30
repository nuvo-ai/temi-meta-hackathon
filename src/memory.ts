import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolContext, ToolExecutor } from './executors/types.js';

/**
 * What Temi remembers about each caller, across calls: their name and what
 * they like to be called, family and the people they mention, where they
 * live, work, payday and regular bills, and how they like Temi to talk. Every
 * memory is shown to the brain at the start of each turn, so Temi uses it
 * naturally ("Morning, Mama Tunde"), and the caller can ask what Temi
 * remembers, correct it, or have it forgotten.
 *
 * Secrets are refused in code, not just by the prompt: no PINs, passwords,
 * card or account numbers, BVN/NIN or one-time codes are ever stored.
 */

export const MEMORY_TOOLS = new Set(['remember', 'forget']);

export const MEMORY_CATEGORIES = ['identity', 'people', 'place', 'work', 'money_habits', 'preferences', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface MemoryItem {
    id: string;
    category: MemoryCategory;
    /** One short sentence, e.g. "Prefers to be called Mama Tunde." */
    fact: string;
    savedAt: string;
    updatedAt: string;
}

/** Most facts kept per caller; the prompt carries all of them on every turn. */
export const MAX_MEMORIES = 60;
const MAX_FACT_CHARS = 200;

const SECRET_WORDS = /\b(pin|password|passcode|otp|one[- ]time|cvv|bvn|nin|card number|secret)\b/i;
const LONG_NUMBER = /\d[\d\s-]{8,}\d/; // 10+ digits: account, card, BVN, NIN, phone

/** Why a fact can't be stored, or null if it can. */
export function refuseReason(fact: string): string | null {
    if (!fact.trim()) return 'nothing to remember';
    if (fact.length > MAX_FACT_CHARS) return `too long; keep it to one short sentence (max ${MAX_FACT_CHARS} characters)`;
    if (SECRET_WORDS.test(fact)) return 'never store PINs, passwords, codes or ID numbers; tell the caller you can\'t keep that';
    if (LONG_NUMBER.test(fact)) return 'never store account, card, ID or phone numbers in memory; saved recipients cover that';
    return null;
}

export class Memory implements ToolExecutor {
    private readonly byOwner = new Map<string, MemoryItem[]>();
    private nextId = 1;

    /** With a file path, memories survive restarts; without one, they live in memory only. */
    constructor(private readonly file?: string) {
        if (file && existsSync(file)) {
            const saved = JSON.parse(readFileSync(file, 'utf8')) as { nextId: number; owners: Record<string, MemoryItem[]> };
            this.nextId = saved.nextId;
            for (const [owner, items] of Object.entries(saved.owners)) this.byOwner.set(owner, items);
        }
    }

    list(owner: string): MemoryItem[] {
        return this.byOwner.get(owner) ?? [];
    }

    /** The caller's memories as prompt lines: "[m3] (people) Mum lives in Ibadan." */
    forPrompt(owner: string): string {
        return this.list(owner)
            .map((m) => `[${m.id}] (${m.category}) ${m.fact}`)
            .join('\n');
    }

    async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
        const owner = ownerOf(ctx);
        const items = [...this.list(owner)];
        const now = new Date().toISOString();
        switch (name) {
            case 'remember': {
                const fact = String(args['fact'] ?? '').trim();
                const refused = refuseReason(fact);
                if (refused) return { status: 'refused', reason: refused };
                const category = (MEMORY_CATEGORIES as readonly string[]).includes(String(args['category'])) ? (args['category'] as MemoryCategory) : 'other';
                const replaces = args['replaces'] ? String(args['replaces']) : undefined;
                if (replaces) {
                    const old = items.find((m) => m.id === replaces);
                    if (!old) return { error: `no memory ${replaces}` };
                    Object.assign(old, { fact, category, updatedAt: now });
                    this.save(owner, items);
                    return { status: 'updated', id: old.id, fact };
                }
                if (items.some((m) => m.fact.toLowerCase() === fact.toLowerCase())) return { status: 'already_known', fact };
                if (items.length >= MAX_MEMORIES) return { error: `memory full (${MAX_MEMORIES}); forget something old first` };
                const item: MemoryItem = { id: `m${this.nextId++}`, category, fact, savedAt: now, updatedAt: now };
                this.save(owner, [...items, item]);
                return { status: 'saved', id: item.id, fact };
            }
            case 'forget': {
                const ids = String(args['id'] ?? '') === 'all' ? items.map((m) => m.id) : [String(args['id'] ?? '')];
                const gone = items.filter((m) => ids.includes(m.id));
                if (gone.length === 0) return { error: 'no such memory; use an id from the list in your instructions' };
                this.save(owner, items.filter((m) => !ids.includes(m.id)));
                return { status: 'forgotten', facts: gone.map((m) => m.fact) };
            }
            default:
                return { error: `unknown tool ${name}` };
        }
    }

    private save(owner: string, items: MemoryItem[]): void {
        if (items.length) this.byOwner.set(owner, items);
        else this.byOwner.delete(owner);
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify({ nextId: this.nextId, owners: Object.fromEntries(this.byOwner) }, null, 2));
    }
}

/** Memories follow the caller's phone number across calls; callerId is the fallback. */
export function ownerOf(ctx: { callerId: string; callerNumber?: string }): string {
    return ctx.callerNumber ?? ctx.callerId;
}
