import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { runTurn } from './agent.js';
import { config, providerConfig } from './config.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryFromNumber, isCountryCode } from './countries.js';
import type { Message } from './model.js';
import { createRuntime } from './runtime.js';
import { startReminderCalls } from './reminders.js';
import { registerVoice } from './voice.js';

const runtime = createRuntime(undefined, { memoryFile: config.memoryFile || undefined, remindersFile: config.remindersFile || undefined });
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

// Anyone who opens the service URL in a browser lands here, not on a 404.
app.get('/', async (_req, reply) =>
    reply.type('text/html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Temi AI</title>
<style>:root{--bg:#fff;--fg:#111;--muted:#555;--accent:#0a7d4f}@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#f2f2f2;--muted:#aaa;--accent:#3ccf8e}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:18px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:0 16px}
a.call{display:inline-block;margin:16px 0;padding:14px 28px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:22px}p{color:var(--muted);margin:4px 0}a{color:var(--accent)}</style></head>
<body><main><h1>Temi AI is running</h1><p>A voice agent anyone can call from a normal phone: no smartphone, data or app.</p>
<a class="call" href="tel:+17755872049">📞 Call Temi: +1 (775) 587-2049</a>
<p>Powered by Meta's ${runtime.model.label.replace('meta:', '')}. Built by Team Temi AI by <a href="https://nuvoai.africa">NuvoAI</a>.</p>
<p><a href="https://github.com/nuvo-ai/temi-meta-hackathon">Code on GitHub</a></p></main></body></html>`),
);

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
        for await (const event of runTurn({ ...runtime, callerId, callerNumber, history, country, profile, signal: abort.signal })) {
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
startReminderCalls(runtime.reminders, app.log);

/** Logs once at startup whether the Meta key can see the configured model, so a wrong key or model shows up before the first call does. */
async function checkModelAccess(): Promise<void> {
    const { baseURL, apiKey, model } = providerConfig();
    try {
        const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return app.log.error({ status: res.status, baseURL, model: JSON.stringify(model) }, 'Meta Model API rejected the key: check MODEL_API_KEY');
        const body = await res.text();
        let ids: string[] = [];
        try {
            ids = ((JSON.parse(body) as { data?: Array<{ id: string }> }).data ?? []).map((m) => m.id);
        } catch {
            // Not JSON: logged below.
        }
        if (ids.includes(model)) app.log.info({ model, baseURL }, 'Meta model available');
        else app.log.error({ model: JSON.stringify(model), baseURL, available: ids, response: body.slice(0, 300) }, 'this key cannot use the configured model: check META_MODEL, META_BASE_URL and MODEL_API_KEY');
    } catch (err) {
        app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'could not reach the Meta Model API');
    }
}

app.listen({ port: config.port, host: '0.0.0.0' })
    .then(() => checkModelAccess())
    .catch((err) => {
        app.log.error(err);
        process.exit(1);
    });
