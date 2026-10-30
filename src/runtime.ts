import { config, guardProviderConfig, providerConfig } from './config.js';
import { HttpExecutor } from './executors/http.js';
import { MockBank } from './executors/mock-bank.js';
import type { ToolExecutor } from './executors/types.js';
import { FraudGuard } from './guard.js';
import { MetaClient, type ModelClient } from './model.js';
import { MEMORY_TOOLS, Memory } from './memory.js';
import { REMINDER_TOOLS, Reminders } from './reminders.js';

export interface Runtime {
    model: ModelClient;
    guard: FraudGuard;
    executor: ToolExecutor;
    reminders: Reminders;
    memory: Memory;
}

/**
 * Wires Muse Spark, the fraud check and the tools from env config. Reminder
 * and memory tools run here; everything else goes to the bank.
 * Pass memoryFile to keep memories across restarts (the server does; evals don't).
 */
export function createRuntime(executor?: ToolExecutor, opts: { memoryFile?: string } = {}): Runtime {
    const bank = executor ?? (config.toolExecutor === 'http' ? new HttpExecutor(config.toolExecutorUrl, config.toolExecutorKey) : new MockBank());
    const reminders = new Reminders();
    const memory = new Memory(opts.memoryFile);
    return {
        model: new MetaClient(providerConfig()),
        guard: new FraudGuard(new MetaClient(guardProviderConfig())),
        executor: {
            execute: (name, args, ctx) => (REMINDER_TOOLS.has(name) ? reminders : MEMORY_TOOLS.has(name) ? memory : bank).execute(name, args, ctx),
        },
        reminders,
        memory,
    };
}
