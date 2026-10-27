import { config, guardProviderConfig, providerConfig, type ProviderName } from './config.js';
import { HttpExecutor } from './executors/http.js';
import { MockBank } from './executors/mock-bank.js';
import type { ToolExecutor } from './executors/types.js';
import { FraudGuard } from './guard.js';
import { OpenAICompatibleClient, type ModelClient } from './model.js';

export interface Runtime {
    model: ModelClient;
    guard: FraudGuard;
    executor: ToolExecutor;
}

/** Wires model, fraud check and tool executor from env config. */
export function createRuntime(provider: ProviderName = config.provider, executor?: ToolExecutor): Runtime {
    return {
        model: new OpenAICompatibleClient(providerConfig(provider)),
        // The fraud check always runs on Meta, whichever model drives the conversation.
        guard: new FraudGuard(config.guard, new OpenAICompatibleClient(guardProviderConfig())),
        executor:
            executor ??
            (config.toolExecutor === 'http' ? new HttpExecutor(config.toolExecutorUrl, config.toolExecutorKey) : new MockBank()),
    };
}
