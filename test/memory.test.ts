import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Memory, refuseReason } from '../src/memory.js';

const chidi = { callerId: 'call-1', callerNumber: '+2348031234567' };

describe('memory', () => {
    it('refuses secrets and numbers', () => {
        expect(refuseReason('Their PIN is 1234')).toMatch(/never store/);
        expect(refuseReason('BVN 22233344455')).toMatch(/never store/);
        expect(refuseReason('Account 0123456789 at GTBank')).toMatch(/never store/);
        expect(refuseReason('Gets paid on the 25th.')).toBeNull();
        expect(refuseReason('Pays rent of 50,000 naira every month.')).toBeNull();
    });

    it('saves, corrects, forgets, and keeps callers apart', async () => {
        const m = new Memory();
        const saved = (await m.execute('remember', { fact: 'Sister Ada lives in Enugu.', category: 'people' }, chidi)) as { id: string };
        expect(await m.execute('remember', { fact: 'Sister Ada lives in Enugu.', category: 'people' }, chidi)).toMatchObject({ status: 'already_known' });
        await m.execute('remember', { fact: 'Ada moved to Lagos.', category: 'people', replaces: saved.id }, chidi);
        expect(m.forPrompt('+2348031234567')).toBe(`[${saved.id}] (people) Ada moved to Lagos.`);
        // A new call from the same number sees the same memories; another caller sees none.
        expect(m.list('+2348031234567')).toHaveLength(1);
        expect(m.forPrompt('+254700000000')).toBe('');
        expect(await m.execute('remember', { fact: 'PIN is 1234', category: 'other' }, chidi)).toMatchObject({ status: 'refused' });
        expect(await m.execute('forget', { id: 'all' }, chidi)).toMatchObject({ status: 'forgotten' });
        expect(m.list('+2348031234567')).toHaveLength(0);
    });

    it('survives a restart when given a file', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'temi-memory-')), 'memory.json');
        await new Memory(file).execute('remember', { fact: 'Prefers to be called Mama Tunde.', category: 'identity' }, chidi);
        const after = new Memory(file);
        expect(after.forPrompt('+2348031234567')).toContain('Mama Tunde');
        expect(((await after.execute('remember', { fact: 'Lives in Ibadan.', category: 'place' }, chidi)) as { id: string }).id).toBe('m2');
    });
});
