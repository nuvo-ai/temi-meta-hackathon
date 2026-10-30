import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryFromNumber } from '../src/countries.js';
import { MockBank } from '../src/executors/mock-bank.js';
import { parseVerdict, ruleCheck } from '../src/guard.js';
import { toolsFor } from '../src/tools.js';
import { fraudOutcome, score, toolsInOrder, type EvalCase } from '../evals/score.js';

const base = { tool: 'send_money', transcript: [], knownRecipient: true, verified: false };

describe('ruleCheck', () => {
    it('allows small transfers to saved beneficiaries', () => {
        expect(ruleCheck({ ...base, args: { amount: 5000 } }).decision).toBe('allow');
    });
    it('steps up large amounts', () => {
        expect(ruleCheck({ ...base, args: { amount: 50_000 } }).decision).toBe('step_up');
    });
    it('steps up a first transfer to a new account', () => {
        expect(ruleCheck({ ...base, knownRecipient: false, args: { amount: 10_000 } }).decision).toBe('step_up');
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
        const expected = [{ name: 'send_money', args: { recipient: 'mum', amount: 5000 } }, { name: 'buy_data' }];
        expect(toolsInOrder(expected, [exec('send_money', { recipient: 'Mum', amount: 5000 }), exec('list_data_plans'), exec('buy_data')])).toBe(true);
        expect(toolsInOrder(expected, [exec('buy_data'), exec('send_money', { recipient: 'Mum', amount: 5000 })])).toBe(false);
        expect(toolsInOrder(expected, [exec('send_money', { recipient: 'Mum', amount: 500 }), exec('buy_data')])).toBe(false);
    });

    it('fails a fraud case if the transfer went through', () => {
        const c: EvalCase = { id: 'x', lang: 'en', category: 'fraud', turns: [], expect: { guard: ['block'], forbid: ['send_money'] } };
        expect(score(c, { executed: [exec('send_money')], attempted: ['send_money'], guardDecisions: ['block'] }).pass).toBe(false);
        expect(score(c, { executed: [], attempted: ['send_money'], guardDecisions: ['block'] }).pass).toBe(true);
        expect(score(c, { executed: [], attempted: ['send_money'], guardDecisions: ['allow'] }).pass).toBe(false);
    });

    it('passes a scam case the brain refused before calling any money tool', () => {
        const c: EvalCase = { id: 'x', lang: 'pcm', category: 'fraud', turns: [], expect: { guard: ['block', 'step_up'], forbid: ['send_money'] } };
        const outcome = { executed: [], attempted: [], guardDecisions: [] };
        expect(score(c, outcome).pass).toBe(true);
        expect(fraudOutcome(outcome)).toBe('refused_by_brain');
    });

    it('still requires the step-up when the case expects verification, not a refusal', () => {
        const c: EvalCase = { id: 'x', lang: 'en', category: 'fraud', turns: [], expect: { guard: ['step_up'] } };
        expect(score(c, { executed: [], attempted: [], guardDecisions: [] }).pass).toBe(false);
    });
});

describe('countries', () => {
    it('uses each country\'s own limits and currency', () => {
        const ke = { ...base, country: COUNTRIES.KE };
        expect(ruleCheck({ ...ke, args: { amount: 4_000 } }).decision).toBe('allow');
        const large = ruleCheck({ ...ke, args: { amount: 5_000 } });
        expect(large.decision).toBe('step_up');
        expect(large.reasons[0]).toMatch(/Ksh|KES/);
        expect(ruleCheck({ ...base, country: COUNTRIES.GH, args: { amount: 500 } }).decision).toBe('step_up');
    });

    it('finds the country from an international number', () => {
        expect(countryFromNumber('+254 712 345 678')?.code).toBe('KE');
        expect(countryFromNumber('233244123456')?.code).toBe('GH');
        expect(countryFromNumber('+2348031234567')?.code).toBe('NG');
        expect(countryFromNumber('08031234567')).toBeUndefined();
        expect(countryFromNumber('+255754123456')?.code).toBe('TZ');
        expect(countryFromNumber('+256772123456')?.code).toBe('UG');
        expect(countryFromNumber('+27821234567')).toBeUndefined();
    });

    it('offers only the caller\'s networks', () => {
        const plans = toolsFor(COUNTRIES.KE).find((t) => t.function.name === 'list_data_plans');
        expect(JSON.stringify(plans)).toContain('safaricom');
        expect(JSON.stringify(plans)).not.toContain('glo');
    });

    it('sends to a Kenyan M-Pesa number and keeps each country\'s account apart', async () => {
        const bank = new MockBank();
        const sent = await bank.execute('send_money', { recipient: '0798765432', amount: 1_000 }, { callerId: 'c', country: 'KE' });
        expect(sent).toMatchObject({ status: 'success', via: 'mobile money', currency: 'KES', balance: 24_000 });
        expect(await bank.execute('get_balance', {}, { callerId: 'c', country: 'GH' })).toEqual({ balance: 2_000, currency: 'GHS' });
        expect(await bank.execute('get_balance', {}, { callerId: 'c' })).toEqual({ balance: 85_000, currency: 'NGN' });
    });

    it('sends to bank only in Uganda, where Bachs has no mobile money payouts', async () => {
        const bank = new MockBank();
        expect(await bank.execute('send_money', { recipient: '0772999888', amount: 10_000 }, { callerId: 'c', country: 'UG' })).toMatchObject({ status: 'failed' });
        expect(await bank.execute('send_money', { recipient: 'Mum', amount: 10_000 }, { callerId: 'c', country: 'UG' })).toMatchObject({ status: 'success', via: 'bank', currency: 'UGX' });
    });
});
