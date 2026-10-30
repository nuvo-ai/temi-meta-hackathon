import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTurn } from './agent.js';
import { COUNTRIES, isCountryCode } from './countries.js';
import { MockBank } from './executors/mock-bank.js';
import type { Message } from './model.js';
import { createRuntime } from './runtime.js';

// Talk to Temi's brain in the terminal against the mock bank.
//   npm run chat           (Nigeria)
//   npm run chat -- KE     (Kenya; GH for Ghana)
const code = (process.argv[2] ?? 'NG').toUpperCase();
if (!isCountryCode(code)) throw new Error(`Unknown country "${code}". Use one of: ${Object.keys(COUNTRIES).join(', ')}`);
const country = COUNTRIES[code];
const bank = new MockBank();
const runtime = createRuntime(bank);
const rl = createInterface({ input, output });
const history: Message[] = [];
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const names = bank.account('cli-caller', code).beneficiaries.map((b) => b.nickname).join(', ');
console.log(dim(`Temi brain · ${runtime.model.label} · ${country.name} · mock bank (PIN 1234, beneficiaries: ${names}). Ctrl+C to quit.\n`));

while (true) {
    const line = (await rl.question('You: ')).trim();
    if (!line) continue;
    history.push({ role: 'user', content: line });
    output.write('Temi: ');
    for await (const event of runTurn({ ...runtime, callerId: 'cli-caller', history, country })) {
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
