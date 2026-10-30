import { describe, expect, it } from 'vitest';
import { Reminders, localNow, localToTimestamp } from '../src/reminders.js';

describe('reminders', () => {
    it('reads local time in each country', () => {
        // Lagos is UTC+1, Nairobi UTC+3, Accra UTC+0.
        expect(localToTimestamp('2026-11-02 09:00', 'NG')).toBe(Date.UTC(2026, 10, 2, 8, 0));
        expect(localToTimestamp('2026-11-02 09:00', 'KE')).toBe(Date.UTC(2026, 10, 2, 6, 0));
        expect(localToTimestamp('2026-11-02 09:00', 'GH')).toBe(Date.UTC(2026, 10, 2, 9, 0));
        expect(localToTimestamp('next Friday', 'NG')).toBeNull();
    });

    it('says today in the caller\'s time zone', () => {
        expect(localNow('KE', Date.UTC(2026, 9, 30, 22, 30))).toBe('Saturday 2026-10-31 01:30');
    });

    it('sets, lists, cancels and comes due', async () => {
        let now = Date.UTC(2026, 9, 30, 8, 0);
        const r = new Reminders(() => now);
        const ctx = { callerId: 'c1', callerNumber: '+2348031234567', country: 'NG' as const };
        expect(await r.execute('set_reminder', { what: 'Pay rent', when: '2026-10-30 08:30' }, ctx)).toMatchObject({ error: expect.stringContaining('already passed') });
        const set = (await r.execute('set_reminder', { what: 'Pay rent', when: '2026-10-30 10:00' }, ctx)) as { id: string };
        await r.execute('set_reminder', { what: 'Call Mum', when: '2026-10-31 09:00' }, ctx);
        expect(((await r.execute('list_reminders', {}, ctx)) as { reminders: unknown[] }).reminders).toHaveLength(2);
        expect(((await r.execute('list_reminders', {}, { callerId: 'someone-else' })) as { reminders: unknown[] }).reminders).toHaveLength(0);
        expect(r.takeDue()).toHaveLength(0);
        now = Date.UTC(2026, 9, 30, 9, 0); // 10:00 in Lagos
        expect(r.takeDue().map((x) => x.id)).toEqual([set.id]);
        expect(r.takeDue()).toHaveLength(0);
        const list = (await r.execute('list_reminders', {}, ctx)) as { reminders: Array<{ id: string }> };
        expect(await r.execute('cancel_reminder', { id: list.reminders[0]!.id }, ctx)).toMatchObject({ status: 'cancelled' });
    });
});
