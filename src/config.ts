import 'dotenv/config';

export type ProviderName = 'meta' | 'baseline';

export interface ProviderConfig {
    name: ProviderName;
    apiKey: string;
    baseURL: string;
    model: string;
    /** Extra body fields this provider accepts (e.g. reasoning_effort for Muse Spark). */
    extraBody: Record<string, unknown>;
    /** Whether the provider returns token usage on streams via stream_options. */
    streamUsage: boolean;
    priceInPerM: number;
    priceOutPerM: number;
}

const env = (key: string, fallback = ''): string => process.env[key] ?? fallback;
const num = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && process.env[key] !== '' && process.env[key] !== undefined ? v : fallback;
};

export function providerConfig(name: ProviderName): ProviderConfig {
    if (name === 'meta') {
        return {
            name,
            apiKey: env('MODEL_API_KEY'),
            baseURL: env('META_BASE_URL', 'https://api.meta.ai/v1'),
            model: env('META_MODEL', 'muse-spark-1.3'),
            extraBody: { reasoning_effort: env('META_REASONING_EFFORT', 'low') },
            // Not confirmed for the Meta Model API yet; token counts fall back to an estimate.
            streamUsage: env('META_STREAM_USAGE') === 'true',
            priceInPerM: num('META_PRICE_IN_PER_M', 0),
            priceOutPerM: num('META_PRICE_OUT_PER_M', 0),
        };
    }
    return {
        name,
        apiKey: env('BASELINE_API_KEY'),
        baseURL: env('BASELINE_BASE_URL', 'https://api.openai.com/v1'),
        model: env('BASELINE_MODEL', 'gpt-4o-mini'),
        extraBody: { temperature: 0.7 },
        streamUsage: true,
        priceInPerM: num('BASELINE_PRICE_IN_PER_M', 0.15),
        priceOutPerM: num('BASELINE_PRICE_OUT_PER_M', 0.6),
    };
}

export function guardProviderConfig(): ProviderConfig {
    const base = providerConfig('meta');
    return {
        ...base,
        model: env('GUARD_MODEL', base.model),
        extraBody: { reasoning_effort: env('GUARD_REASONING_EFFORT', 'medium') },
    };
}

export const config = {
    provider: (env('PROVIDER', 'meta') === 'baseline' ? 'baseline' : 'meta') as ProviderName,
    port: num('PORT', 8787),
    brainApiKey: env('BRAIN_API_KEY'),
    toolExecutor: env('TOOL_EXECUTOR', 'mock') as 'mock' | 'http',
    toolExecutorUrl: env('TOOL_EXECUTOR_URL'),
    toolExecutorKey: env('TOOL_EXECUTOR_KEY'),
    guard: {
        stepUpNgn: num('GUARD_STEP_UP_NGN', 50_000),
        newRecipientStepUpNgn: num('GUARD_NEW_RECIPIENT_STEP_UP_NGN', 10_000),
    },
    usdToNgn: num('USD_TO_NGN', 1500),
};
