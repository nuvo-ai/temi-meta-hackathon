import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { runTurn } from './agent.js';
import { config } from './config.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryFromNumber, isCountryCode, type Country, type CountryCode } from './countries.js';
import type { Message } from './model.js';
import type { Runtime } from './runtime.js';

/**
 * A phone line straight into the brain, for live demo calls: point a Twilio
 * number's voice webhook at POST /voice/incoming. Twilio hears the caller
 * (<Gather input="speech">) and speaks Temi's reply (<Say>); Muse Spark does
 * everything in between. Production Temi streams audio instead, for faster
 * replies and better voices in local languages.
 */

/** Speech recognition language per country. Callers can still mix languages; the transcript is what Temi sees. */
const SPEECH_LANGUAGE: Record<CountryCode, string> = {
    NG: 'en-NG',
    KE: 'en-KE',
    GH: 'en-GH',
    TZ: 'sw-TZ',
    UG: 'en-US',
};

interface Call {
    country: Country;
    history: Message[];
    lastSeen: number;
    /** TwiML for a reply still being worked out, fetched by /voice/reply. */
    pending?: Promise<string>;
}

/**
 * Muse Spark takes about 1.3s to start answering. If the reply isn't ready by
 * then, the caller hears a short acknowledgement instead of silence, and
 * Twilio fetches the real reply from /voice/reply.
 */
const ACK_AFTER_MS = 800;
const ACKS: Record<CountryCode, string[]> = {
    NG: ['Okay.', 'Alright.', 'Mm.'],
    KE: ['Sawa.', 'Okay.', 'Mm.'],
    GH: ['Okay.', 'Alright.', 'Mm.'],
    TZ: ['Sawa.', 'Haya.', 'Mm.'],
    UG: ['Okay.', 'Kale.', 'Mm.'],
};
let ackTurn = 0;

const calls = new Map<string, Call>();
const CALL_TTL_MS = 60 * 60 * 1000;

const xml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function say(text: string): string {
    const voice = config.voice.twilioVoice ? ` voice="${xml(config.voice.twilioVoice)}"` : '';
    return `<Say${voice}>${xml(text)}</Say>`;
}

/** Speak `text` (the caller can talk over it), then listen for the caller's next turn. */
function listen(text: string, country: Country): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="/voice/turn" method="POST" speechTimeout="auto" language="${SPEECH_LANGUAGE[country.code]}">${say(text)}</Gather><Redirect method="POST">/voice/turn</Redirect></Response>`;
}

/**
 * Twilio signs each webhook with the account's auth token. Checked only when
 * TWILIO_AUTH_TOKEN and PUBLIC_URL are set; without them anyone who finds the
 * URL can talk to the mock bank, which is fine for a short test window.
 */
function fromTwilio(req: FastifyRequest<{ Body: Record<string, string> }>): boolean {
    const { twilioAuthToken, publicUrl } = config.voice;
    if (!twilioAuthToken || !publicUrl) return true;
    const params = req.body ?? {};
    const signed = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], publicUrl.replace(/\/$/, '') + req.url);
    const expected = Buffer.from(createHmac('sha1', twilioAuthToken).update(signed).digest('base64'));
    const got = Buffer.from(String(req.headers['x-twilio-signature'] ?? ''));
    return got.length === expected.length && timingSafeEqual(got, expected);
}

function countryFor(from: string | undefined): Country {
    const forced = config.voice.country;
    if (forced && isCountryCode(forced)) return COUNTRIES[forced];
    return countryFromNumber(from) ?? DEFAULT_COUNTRY;
}

/** Runs one caller turn on the brain and returns the TwiML that speaks Temi's reply. */
async function answer(runtime: Runtime, req: FastifyRequest, callSid: string, call: Call): Promise<string> {
    let spoken = '';
    try {
        for await (const event of runTurn({ ...runtime, callerId: callSid, history: call.history, country: call.country })) {
            if (event.type === 'text') spoken += event.delta;
            if (event.type === 'guard') req.log.info({ callSid, tool: event.tool, guard: event.result }, 'fraud check');
            if (event.type === 'done') {
                call.history.push(...event.messages);
                req.log.info({ callSid, spoken, timings: event.timings, hops: event.hops }, 'voice turn');
            }
        }
    } catch (err) {
        req.log.error({ callSid, err: err instanceof Error ? err.message : String(err) }, 'voice turn failed');
        call.history.pop();
        return listen('Sorry, something went wrong on my side. Could you say that again?', call.country);
    }
    return listen(spoken.trim() || 'Is there anything else I can help with?', call.country);
}

export function registerVoice(app: FastifyInstance, runtime: Runtime): void {
    // Twilio posts form-encoded bodies; Fastify only parses JSON out of the box.
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });

    app.post<{ Body: Record<string, string> }>('/voice/incoming', async (req, reply) => {
        if (!fromTwilio(req)) return reply.code(403).send();
        const now = Date.now();
        for (const [sid, call] of calls) if (now - call.lastSeen > CALL_TTL_MS) calls.delete(sid);

        const country = countryFor(req.body?.From);
        calls.set(req.body?.CallSid ?? '', { country, history: [], lastSeen: now });
        req.log.info({ callSid: req.body?.CallSid, country: country.code }, 'call started');
        return reply.type('text/xml').send(listen("Hello, it's Temi. How can I help you today?", country));
    });

    app.post<{ Body: Record<string, string> }>('/voice/turn', async (req, reply) => {
        if (!fromTwilio(req)) return reply.code(403).send();
        const callSid = req.body?.CallSid ?? '';
        const heard = (req.body?.SpeechResult ?? '').trim();
        let call = calls.get(callSid);
        if (!call) {
            // Server restarted mid-call: carry on with a fresh history.
            call = { country: countryFor(req.body?.From), history: [], lastSeen: Date.now() };
            calls.set(callSid, call);
        }
        call.lastSeen = Date.now();
        reply.type('text/xml');

        if (!heard) return reply.send(listen("Sorry, I didn't catch that. Could you say it again?", call.country));

        call.history.push({ role: 'user', content: heard });
        const pending = answer(runtime, req, callSid, call);
        const ready = await Promise.race([pending, new Promise<null>((r) => setTimeout(r, ACK_AFTER_MS, null))]);
        if (ready !== null) return reply.send(ready);
        call.pending = pending;
        const acks = ACKS[call.country.code];
        return reply.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${say(acks[ackTurn++ % acks.length]!)}<Redirect method="POST">/voice/reply</Redirect></Response>`);
    });

    app.post<{ Body: Record<string, string> }>('/voice/reply', async (req, reply) => {
        if (!fromTwilio(req)) return reply.code(403).send();
        const call = calls.get(req.body?.CallSid ?? '');
        reply.type('text/xml');
        if (!call?.pending) return reply.send(listen('Sorry, could you say that again?', call?.country ?? DEFAULT_COUNTRY));
        const twiml = await call.pending;
        call.pending = undefined;
        return reply.send(twiml);
    });
}
