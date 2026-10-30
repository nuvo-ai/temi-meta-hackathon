import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { runTurn } from './agent.js';
import { config } from './config.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryFromNumber, isCountryCode } from './countries.js';
import type { Message } from './model.js';
import { createRuntime } from './runtime.js';
import { registerVoice } from './voice.js';

const runtime = createRuntime();
const app = Fastify({ logger: { level: 'info' } });

function authorized(header: string | undefined): boolean {
    if (!config.brainApiKey) return false;
    const expected = Buffer.from(`Bearer ${config.brainApiKey}`);
    const got = Buffer.from(header ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
}

app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/v1/') && !authorized(req.headers.authorization)) {
        return reply.code(401).send({ error: 'unauthorized' });
    }
});

app.get('/health', async () => ({ ok: true, model: runtime.model.label }));

interface TurnBody {
    callerId: string;
    history: Message[];
    /** "NG", "KE" or "GH". If missing, taken from callerNumber, then Nigeria. */
    country?: string;
    /** Caller's number in international format, e.g. +254712345678. */
    callerNumber?: string;
    profile?: string;
}

/**
 * One caller turn, streamed as Server-Sent Events. Each event is one JSON
 * AgentEvent: text deltas to speak, tool calls (play a filler when `slow`),
 * fraud-check verdicts, tool results, and a final `done` with the messages to
 * append to the caller's history.
 */
app.post<{ Body: TurnBody }>('/v1/turn', async (req, reply) => {
    const { callerId, history, profile, country: code, callerNumber } = req.body ?? ({} as TurnBody);
    if (!callerId || !Array.isArray(history)) return reply.code(400).send({ error: 'callerId and history are required' });
    if (code !== undefined && !isCountryCode(code)) {
        return reply.code(400).send({ error: `unsupported country "${code}"; supported: ${Object.keys(COUNTRIES).join(', ')}` });
    }
    const country = code ? COUNTRIES[code] : (countryFromNumber(callerNumber) ?? DEFAULT_COUNTRY);

    // Caller hung up or barged in: stop generating. (The request's own 'close'
    // fires once the body is read, so watch the response instead.)
    const abort = new AbortController();
    reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
    });

    reply.hijack();
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
        for await (const event of runTurn({ ...runtime, callerId, history, country, profile, signal: abort.signal })) {
            send(event);
            if (event.type === 'guard') req.log.info({ callerId, country: country.code, tool: event.tool, guard: event.result }, 'fraud check');
            if (event.type === 'done') req.log.info({ callerId, timings: event.timings, hops: event.hops, usage: event.usage }, 'turn done');
        }
    } catch (err) {
        if (!abort.signal.aborted) {
            req.log.error({ err: err instanceof Error ? err.message : String(err) }, 'turn failed');
            send({ type: 'error', message: 'brain unavailable' });
        }
    } finally {
        reply.raw.end();
    }
});

registerVoice(app, runtime);

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
});
