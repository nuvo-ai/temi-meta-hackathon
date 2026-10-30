import 'dotenv/config';

export interface ProviderConfig {
    apiKey: string;
    baseURL: string;
    model: string;
    /** Extra body fields Muse Spark accepts, e.g. reasoning_effort. */
    extraBody: Record<string, unknown>;
    priceInPerM: number;
    priceOutPerM: number;
}

// Trimmed: a value pasted into a dashboard with a trailing space or newline
// ("muse-spark-1.3 ") otherwise reaches the API and fails as model_not_found.
const env = (key: string, fallback = ''): string => process.env[key]?.trim() ?? fallback;
const num = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && process.env[key] !== '' && process.env[key] !== undefined ? v : fallback;
};

/** Muse Spark on the Meta Model API: the conversation model. */
export function providerConfig(): ProviderConfig {
    return {
        apiKey: env('MODEL_API_KEY'),
        baseURL: env('META_BASE_URL', 'https://api.meta.ai/v1'),
        model: env('META_MODEL', 'muse-spark-1.3'),
        // minimal: same 36/36 on the evals as low, with plain turns starting in
        // about 1.3s instead of 2–3s and half the output tokens.
        extraBody: { reasoning_effort: env('META_REASONING_EFFORT', 'minimal') },
        priceInPerM: num('META_PRICE_IN_PER_M', 0),
        priceOutPerM: num('META_PRICE_OUT_PER_M', 0),
    };
}

export function guardProviderConfig(): ProviderConfig {
    const base = providerConfig();
    return {
        ...base,
        model: env('GUARD_MODEL', base.model),
        // minimal matched medium on evals/guard-cases.json at about half the latency;
        // medium blew the 4s budget on long, messy calls.
        extraBody: { reasoning_effort: env('GUARD_REASONING_EFFORT', 'minimal') },
    };
}

export const config = {
    port: num('PORT', 8787),
    brainApiKey: env('BRAIN_API_KEY'),
    toolExecutor: env('TOOL_EXECUTOR', 'mock') as 'mock' | 'http',
    toolExecutorUrl: env('TOOL_EXECUTOR_URL'),
    toolExecutorKey: env('TOOL_EXECUTOR_KEY'),
    /** Where the server keeps what Temi remembers about callers. Empty keeps it in memory only. */
    memoryFile: env('MEMORY_FILE', 'data/memory.json'),
    /** Nigeria's fraud-check limits in naira; other countries set theirs in src/countries.ts. */
    guard: {
        stepUp: num('GUARD_STEP_UP_NGN', 50_000),
        newRecipientStepUp: num('GUARD_NEW_RECIPIENT_STEP_UP_NGN', 10_000),
    },
    usdToNgn: num('USD_TO_NGN', 1500),
    /** Live demo calls through Twilio: src/voice.ts. */
    voice: {
        /** Public https URL Twilio calls, e.g. the ngrok URL. Needed only to check Twilio's signature. */
        publicUrl: env('PUBLIC_URL'),
        twilioAuthToken: env('TWILIO_AUTH_TOKEN'),
        /** For outbound reminder calls (src/reminders.ts). */
        twilioAccountSid: env('TWILIO_ACCOUNT_SID'),
        twilioFromNumber: env('TWILIO_FROM_NUMBER'),
        /** Optional Twilio <Say> voice, e.g. Polly.Ayanda-Neural. Empty uses Twilio's default. */
        twilioVoice: env('TWILIO_VOICE'),
        /** Force a country for every call (NG, KE, GH, TZ or UG), e.g. to demo Kenya from a Nigerian phone. */
        country: env('VOICE_COUNTRY'),
    },
};
