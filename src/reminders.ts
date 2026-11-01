import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { COUNTRIES, DEFAULT_COUNTRY, type CountryCode } from './countries.js';
import type { ToolContext, ToolExecutor } from './executors/types.js';

/**
 * Reminders, and the outbound calls that deliver them. A caller asks Temi to
 * remind them of anything (a bill, a loan repayment, an appointment); when
 * it's due, Temi phones them, says what it's about, and they can act on it
 * in the same call ("yes, pay it now").
 *
 * With a file, reminders survive a restart: pending ones still go out, and
 * one that was mid-call when the server stopped is tried again. Production
 * Temi keeps them in its database and places the calls itself.
 */

export const REMINDER_TOOLS = new Set(['set_reminder', 'list_reminders', 'cancel_reminder']);

export interface Reminder {
    id: string;
    /** Who to call: the caller's number when known, else their callerId. */
    owner: string;
    callerNumber?: string;
    country: CountryCode;
    /** What it's about, in the caller's own language. */
    what: string;
    /** When it's due, as the caller's local time "YYYY-MM-DD HH:mm". */
    when: string;
    dueAt: number;
    status: 'pending' | 'calling' | 'called' | 'cancelled' | 'failed';
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** Turns "YYYY-MM-DD HH:mm" in the country's time zone into a timestamp. */
export function localToTimestamp(when: string, country: CountryCode): number | null {
    const m = LOCAL.exec(when.trim());
    if (!m) return null;
    const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
    const asUtc = Date.UTC(y, mo - 1, d, h, mi);
    // These countries don't observe daylight saving, so one offset lookup is exact.
    const offsetMin = utcOffsetMinutes(COUNTRIES[country].timeZone, asUtc);
    return asUtc - offsetMin * 60_000;
}

function utcOffsetMinutes(timeZone: string, at: number): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(at))
        .reduce<Record<string, number>>((acc, p) => (p.type === 'literal' ? acc : { ...acc, [p.type]: Number(p.value) }), {});
    return (Date.UTC(parts['year']!, parts['month']! - 1, parts['day']!, parts['hour']!, parts['minute']!) - at) / 60_000;
}

/** The caller's local date and time now, for the prompt: "Friday 2026-10-30 14:05". */
export function localNow(country: CountryCode, now = Date.now()): string {
    const tz = COUNTRIES[country].timeZone;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
    return `${day} ${date} ${time}`;
}

/** What the brain is told when the caller picks up a reminder call. */
export function reminderCallProfile(what: string, when?: string): string {
    return `You placed this call because the caller asked you to remind them: "${what}"${when ? ` (due ${when})` : ''}. Greet them as Temi, say what the reminder is in the language it is written in, and offer to help them act on it now. A payment still needs the usual read-back and a clear yes.`;
}

export class Reminders implements ToolExecutor {
    private readonly items = new Map<string, Reminder>();
    private nextId = 1;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly file?: string,
    ) {
        if (file && existsSync(file)) {
            const saved = JSON.parse(readFileSync(file, 'utf8')) as { nextId: number; items: Reminder[] };
            this.nextId = saved.nextId;
            for (const r of saved.items) {
                // The server stopped while placing this call: try it again.
                if (r.status === 'calling') r.status = 'pending';
                this.items.set(r.id, r);
            }
        }
    }

    /** Writes every reminder to the file, if there is one. Written to a temp file first, so a crash mid-write can't corrupt it. */
    private save(): void {
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ nextId: this.nextId, items: [...this.items.values()] }, null, 2));
        renameSync(tmp, this.file);
    }

    /** Records how a reminder call went. */
    markCalled(id: string, ok: boolean): void {
        const r = this.items.get(id);
        if (!r) return;
        r.status = ok ? 'called' : 'failed';
        this.save();
    }

    get(id: string): Reminder | undefined {
        return this.items.get(id);
    }

    async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
        const owner = ctx.callerNumber ?? ctx.callerId;
        const country = ctx.country ?? DEFAULT_COUNTRY.code;
        const mine = () => [...this.items.values()].filter((r) => r.owner === owner && r.status === 'pending');
        switch (name) {
            case 'set_reminder': {
                const what = String(args['what'] ?? '').trim();
                const when = String(args['when'] ?? '').trim();
                if (!what) return { error: 'what is the reminder about?' };
                const dueAt = localToTimestamp(when, country);
                if (dueAt === null) return { error: 'when must be the caller\'s local time as "YYYY-MM-DD HH:mm"' };
                if (dueAt <= this.now()) return { error: `${when} has already passed; it is now ${localNow(country, this.now())}` };
                const r: Reminder = { id: `r${this.nextId++}`, owner, callerNumber: ctx.callerNumber, country, what, when, dueAt, status: 'pending' };
                this.items.set(r.id, r);
                this.save();
                return { status: 'set', id: r.id, what, when, delivery: ctx.callerNumber ? 'Temi will call the caller then' : 'saved' };
            }
            case 'list_reminders':
                return { reminders: mine().map(({ id, what, when }) => ({ id, what, when })) };
            case 'cancel_reminder': {
                const r = this.items.get(String(args['id'] ?? ''));
                if (!r || r.owner !== owner || r.status !== 'pending') return { error: 'no such pending reminder; call list_reminders' };
                r.status = 'cancelled';
                this.save();
                return { status: 'cancelled', id: r.id, what: r.what };
            }
            default:
                return { error: `unknown tool ${name}` };
        }
    }

    /** Reminders now due that have a number to call, marked as being called. */
    takeDue(): Reminder[] {
        const due = [...this.items.values()].filter((r) => r.status === 'pending' && r.callerNumber && r.dueAt <= this.now());
        for (const r of due) r.status = 'calling';
        if (due.length) this.save();
        return due;
    }
}

/**
 * Every 15s, phones whoever has a reminder due, through Twilio. The call
 * opens at /voice/reminder (src/voice.ts). Needs TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and PUBLIC_URL; without them,
 * reminders are saved but no calls go out.
 */
export function startReminderCalls(reminders: Reminders, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): void {
    const { twilioAccountSid: sid, twilioAuthToken: token, twilioFromNumber: from, publicUrl } = config.voice;
    if (!sid || !token || !from || !publicUrl) {
        log.info({}, 'reminder calls off: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and PUBLIC_URL');
        return;
    }
    const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
    setInterval(async () => {
        for (const r of reminders.takeDue()) {
            const body = new URLSearchParams({ To: r.callerNumber!, From: from, Url: `${publicUrl.replace(/\/$/, '')}/voice/reminder?id=${r.id}`, Method: 'POST' });
            try {
                const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
                    method: 'POST',
                    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body,
                });
                reminders.markCalled(r.id, res.ok);
                log.info({ reminder: r.id, status: res.status }, 'reminder call placed');
            } catch (err) {
                reminders.markCalled(r.id, false);
                log.error({ reminder: r.id, err: err instanceof Error ? err.message : String(err) }, 'reminder call failed');
            }
        }
    }, 15_000).unref();
}
