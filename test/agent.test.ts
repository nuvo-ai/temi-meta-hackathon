import { describe, expect, it } from 'vitest';
import { pinVerifiedForNextPayment, runTurn, type AgentEvent } from '../src/agent.js';
import { MockBank } from '../src/executors/mock-bank.js';
import { FraudGuard } from '../src/guard.js';
import type { Message } from '../src/model.js';
import { ScriptedModel, call } from './helpers.js';


async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
}

describe('runTurn', () => {
    it('streams text and returns the assistant message', async () => {
        const model = new ScriptedModel([{ text: 'Hello there, how can I help?' }]);
        const events = await collect(
            runTurn({ model, executor: new MockBank(), guard: new FraudGuard(), callerId: 'c1', history: [{ role: 'user', content: 'Hi' }] }),
        );
        const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');
        expect(text).toBe('Hello there, how can I help?');
        const done = events.at(-1);
        expect(done?.type).toBe('done');
        if (done?.type === 'done') {
            expect(done.messages).toEqual([{ role: 'assistant', content: 'Hello there, how can I help?' }]);
            expect(done.hops).toBe(1);
        }
    });

    it('runs a tool, feeds the result back, then speaks', async () => {
        const model = new ScriptedModel([{ toolCalls: [call('a', 'get_balance')] }, { text: 'You have 85,000 naira.' }]);
        const events = await collect(
            runTurn({ model, executor: new MockBank(), guard: new FraudGuard(), callerId: 'c1', history: [{ role: 'user', content: 'balance?' }] }),
        );
        const result = events.find((e) => e.type === 'tool_result');
        expect(result).toMatchObject({ name: 'get_balance', result: { balance: 85_000 } });
        expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ slow: true });
        const secondCall = model.seen[1]!;
        expect(secondCall.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'a' });
    });

    it('does not move money when the fraud check blocks', async () => {
        const bank = new MockBank();
        const model = new ScriptedModel(
            [{ toolCalls: [call('t', 'send_money', { recipient: 'Mum', amount: 5000 })] }, { text: "I couldn't do that." }],
            '{"decision":"block","reasons":["caller is being coached"]}',
        );
        const events = await collect(
            runTurn({ model, executor: bank, guard: new FraudGuard(model), callerId: 'c1', history: [{ role: 'user', content: 'send' }] }),
        );
        expect(events.find((e) => e.type === 'guard')).toMatchObject({ result: { decision: 'block' } });
        expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ result: { status: 'blocked' } });
        expect(bank.account('c1').balance).toBe(85_000);
    });

    it('asks for verification on large amounts, then allows after a correct PIN', async () => {
        const bank = new MockBank();
        const model = new ScriptedModel([
            { toolCalls: [call('t1', 'send_money', { recipient: 'Mum', amount: 60_000 })] },
            { text: 'Please tell me your PIN.' },
        ]);
        const guard = new FraudGuard(model);
        const first = await collect(runTurn({ model, executor: bank, guard, callerId: 'c1', history: [{ role: 'user', content: 'send Mum 60k' }] }));
        expect(first.find((e) => e.type === 'tool_result')).toMatchObject({ result: { status: 'needs_verification' } });

        const history: Message[] = [{ role: 'user', content: 'send Mum 60k' }, ...(first.at(-1) as { messages: Message[] }).messages, { role: 'user', content: '1234' }];
        const model2 = new ScriptedModel([
            { toolCalls: [call('p', 'verify_pin', { pin: '1234' })] },
            { toolCalls: [call('t2', 'send_money', { recipient: 'Mum', amount: 60_000 })] },
            { text: 'Done.' },
        ]);
        const second = await collect(runTurn({ model: model2, executor: bank, guard: new FraudGuard(model2), callerId: 'c1', history }));
        expect(second.find((e) => e.type === 'tool_call' && e.name === 'verify_pin')).toMatchObject({ args: { pin: '****' } });
        expect(second.filter((e) => e.type === 'tool_result').at(-1)).toMatchObject({ result: { status: 'success' } });
        expect(bank.account('c1').balance).toBe(25_000);
    });

    it('fails closed to step_up when the fraud model errors', async () => {
        const model = new ScriptedModel([{ toolCalls: [call('t', 'send_money', { recipient: 'Mum', amount: 1000 })] }, { text: 'PIN please.' }]);
        model.complete = async () => { throw new Error('timeout'); };
        const events = await collect(
            runTurn({ model, executor: new MockBank(), guard: new FraudGuard(model), callerId: 'c1', history: [{ role: 'user', content: 'send' }] }),
        );
        expect(events.find((e) => e.type === 'guard')).toMatchObject({ result: { decision: 'step_up' } });
    });
});

describe('speaking before an action', () => {
    const textOf = (events: AgentEvent[]) => events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');

    it("drops an announcement made just before the turn's first tool", async () => {
        const model = new ScriptedModel([
            { text: "I'll send that to Mum now.", toolCalls: [call('t', 'send_money', { recipient: 'Mum', amount: 1000 })] },
            { text: 'Done. I sent one thousand naira to Mum.' },
        ]);
        const events = await collect(runTurn({ model, executor: new MockBank(), guard: new FraudGuard(model), callerId: 'c1', history: [{ role: 'user', content: 'yes' }] }));
        expect(textOf(events)).toBe('Done. I sent one thousand naira to Mum.');
        const done = events.at(-1) as { messages: Message[] };
        expect(done.messages[0]).toMatchObject({ role: 'assistant', content: null });
    });

    it('keeps a result spoken between two tools', async () => {
        const model = new ScriptedModel([
            { toolCalls: [call('a', 'get_balance')] },
            { text: 'You have 85,000 naira.', toolCalls: [call('b', 'recent_transactions')] },
            { text: 'Your last transfer was to Tunde.' },
        ]);
        const events = await collect(runTurn({ model, executor: new MockBank(), guard: new FraudGuard(model), callerId: 'c1', history: [{ role: 'user', content: 'balance and history' }] }));
        expect(textOf(events)).toBe('You have 85,000 naira. Your last transfer was to Tunde.');
    });

    it('streams a plain reply sentence by sentence', async () => {
        const model = new ScriptedModel([{ text: 'Hello there. How can I help you today?' }]);
        const events = await collect(runTurn({ model, executor: new MockBank(), guard: new FraudGuard(), callerId: 'c1', history: [{ role: 'user', content: 'Hi' }] }));
        const deltas = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta);
        expect(deltas).toEqual(['Hello there. ', 'How can I help you today?']);
    });
});

describe('pinVerifiedForNextPayment', () => {
    const asst = (id: string, name: string): Message => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }] });
    const tool = (id: string, content: unknown): Message => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(content) });

    it('is true right after a successful PIN', () => {
        expect(pinVerifiedForNextPayment([asst('p', 'verify_pin'), tool('p', { verified: true })])).toBe(true);
    });

    it('is used up once a payment goes through', () => {
        expect(
            pinVerifiedForNextPayment([asst('p', 'verify_pin'), tool('p', { verified: true }), asst('s', 'send_money'), tool('s', { status: 'success' })]),
        ).toBe(false);
    });

    it('is false after a wrong PIN', () => {
        expect(pinVerifiedForNextPayment([asst('p', 'verify_pin'), tool('p', { verified: false })])).toBe(false);
    });
});
