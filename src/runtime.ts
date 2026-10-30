import { config, guardProviderConfig, providerConfig } from './config.js';
import { HttpExecutor } from './executors/http.js';
import { MockBank } from './executors/mock-bank.js';
import type { ToolExecutor } from './executors/types.js';
import { FraudGuard } from './guard.js';
import { MetaClient, type ModelClient } from './model.js';

export interface Runtime {
    model: ModelClient;
    guard: FraudGuard;
    executor: ToolExecutor;
}

/** Wires Muse Spark, the fraud check and the tool executor from env config. */
export function createRuntime(executor?: ToolExecutor): Runtime {
    return {
        model: new MetaClient(providerConfig()),
        guard: new FraudGuard(new MetaClient(guardProviderConfig())),
        executor:
            executor ??
            (config.toolExecutor === 'http' ? new HttpExecutor(config.toolExecutorUrl, config.toolExecutorKey) : new MockBank()),
    };
}
