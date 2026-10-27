import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTurn } from './agent.js';
import { config, type ProviderName } from './config.js';
import { MockBank } from './executors/mock-bank.js';
import type { Message } from './model.js';
import { createRuntime } from './runtime.js';

// Talk to Temi's brain in the terminal against the mock bank.
//   npm run chat              (uses PROVIDER from .env)
//   npm run chat -- baseline
const provider = (process.argv[2] as ProviderName | undefined) ?? config.provider;
const runtime = createRuntime(provider, new MockBank());
const rl = createInterface({ input, output });
const history: Message[] = [];
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(dim(`Temi brain · ${runtime.model.label} · mock bank (PIN 1234, beneficiaries: Mum, Tunde, Aisha). Ctrl+C to quit.\n`));

while (true) {
    const line = (await rl.question('You: ')).trim();
    if (!line) continue;
    history.push({ role: 'user', content: line });
    output.write('Temi: ');
    for await (const event of runTurn({ ...runtime, callerId: 'cli-caller', history })) {
        if (event.type === 'text') output.write(event.delta);
        else if (event.type === 'tool_call') output.write(dim(`\n  → ${event.name} ${JSON.stringify(event.args)}\n`));
        else if (event.type === 'guard') output.write(dim(`  🛡 ${event.result.decision} (${event.result.latencyMs}ms): ${event.result.reasons.join('; ') || 'ok'}\n`));
        else if (event.type === 'tool_result') output.write(dim(`  ← ${JSON.stringify(event.result)}\n`));
        else if (event.type === 'done') {
            history.push(...event.messages);
            output.write(dim(`\n  [first token ${event.timings.firstTokenMs ?? '-'}ms · total ${event.timings.totalMs}ms · hops ${event.hops}]\n\n`));
        }
    }
}
