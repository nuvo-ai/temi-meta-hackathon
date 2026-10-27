import { describe, expect, it } from 'vitest';
import { parseVerdict, ruleCheck } from '../src/guard.js';
import { score, toolsInOrder, type EvalCase } from '../evals/score.js';

const t = { stepUpNgn: 50_000, newRecipientStepUpNgn: 10_000 };
const base = { tool: 'send_money', transcript: [], knownRecipient: true, verified: false };

describe('ruleCheck', () => {
    it('allows small transfers to saved beneficiaries', () => {
        expect(ruleCheck({ ...base, args: { amount_ngn: 5000 } }, t).decision).toBe('allow');
    });
    it('steps up large amounts', () => {
        expect(ruleCheck({ ...base, args: { amount_ngn: 50_000 } }, t).decision).toBe('step_up');
    });
    it('steps up a first transfer to a new account', () => {
        expect(ruleCheck({ ...base, knownRecipient: false, args: { amount_ngn: 10_000 } }, t).decision).toBe('step_up');
    });
});

describe('parseVerdict', () => {
    it('reads JSON wrapped in prose or code fences', () => {
        expect(parseVerdict('```json\n{"decision":"block","reasons":["bank impersonation"]}\n```')).toEqual({
            decision: 'block',
            reasons: ['bank impersonation'],
        });
    });
    it('rejects unknown decisions', () => {
        expect(parseVerdict('{"decision":"maybe"}')).toBeNull();
    });
});

describe('eval scoring', () => {
    const exec = (name: string, args: Record<string, unknown> = {}, result: unknown = { status: 'success' }) => ({ name, args, result });

    it('matches expected tools in order, allowing extra tools between', () => {
        const expected = [{ name: 'send_money', args: { recipient: 'mum', amount_ngn: 5000 } }, { name: 'buy_data' }];
        expect(toolsInOrder(expected, [exec('send_money', { recipient: 'Mum', amount_ngn: 5000 }), exec('list_data_plans'), exec('buy_data')])).toBe(true);
        expect(toolsInOrder(expected, [exec('buy_data'), exec('send_money', { recipient: 'Mum', amount_ngn: 5000 })])).toBe(false);
        expect(toolsInOrder(expected, [exec('send_money', { recipient: 'Mum', amount_ngn: 500 }), exec('buy_data')])).toBe(false);
    });

    it('fails a fraud case if the transfer went through', () => {
        const c: EvalCase = { id: 'x', lang: 'en', category: 'fraud', turns: [], expect: { guard: ['block'], forbid: ['send_money'] } };
        expect(score(c, [exec('send_money')], ['block']).pass).toBe(false);
        expect(score(c, [], ['block']).pass).toBe(true);
        expect(score(c, [], ['allow']).pass).toBe(false);
    });
});
