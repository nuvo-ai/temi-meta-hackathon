import { describe, expect, it } from 'vitest';
import type { Message } from '../src/model.js';
import { amountReadBackInDigits, pinsSaid, withoutInternalNotes, withoutPins } from '../src/speech.js';

const temi = (content: string): Message => ({ role: 'assistant', content });

describe('speech guards', () => {
    it('drops sentences that are the model talking to itself', () => {
        expect(withoutInternalNotes('We need to retry send after PIN. Ntumye emitwalo ebiri eri Mum.')).toBe('Ntumye emitwalo ebiri eri Mum.');
        expect(withoutInternalNotes('Calling send_money now.')).toBe('');
        expect(withoutInternalNotes('Sawa. Second request still pending, proceeding silently.')).toBe('Sawa. ');
        expect(withoutInternalNotes('We can do one, then next turn do second. Nimetuma.')).toBe('Nimetuma.');
        expect(withoutInternalNotes('Your balance is eighty five thousand naira. Anything else?')).toBe('Your balance is eighty five thousand naira. Anything else?');
    });

    it('knows whether the exact amount was read back in digits', () => {
        const readBack = [temi('Okuweereza Mum USh 20,000, ntukole?'), { role: 'user', content: 'Yee.' } as Message];
        expect(amountReadBackInDigits(20000, readBack)).toBe(true);
        // The Luganda bug: words said 20,000 but the tool asked for 200,000.
        expect(amountReadBackInDigits(200000, readBack)).toBe(false);
        expect(amountReadBackInDigits(20000, [temi('Okuweereza Mum emitwalo ebiri, ntukole?')])).toBe(false);
        expect(amountReadBackInDigits(5000, [temi('Send 5 000 to Mum?')])).toBe(true);
    });

    it('never says a PIN the caller gave', () => {
        const history: Message[] = [{ role: 'user', content: 'My PIN is 4821. Please remember it for me.' }];
        expect(pinsSaid(history)).toEqual(['4821']);
        expect(withoutPins("I can't save your PIN. Just keep 4821 private. Don't share it with anyone.", ['4821'])).toBe("I can't save your PIN. Don't share it with anyone.");
        // Asked for a PIN, then given one on its own line.
        expect(pinsSaid([{ role: 'assistant', content: 'Please say your 4-digit Temi PIN.' }, { role: 'user', content: '1234' }])).toEqual(['1234']);
        // Ordinary amounts are untouched.
        expect(pinsSaid([{ role: 'user', content: 'Send Mum 5000 naira.' }])).toEqual([]);
        expect(withoutPins('Sent 4,821 naira to Mum.', [])).toBe('Sent 4,821 naira to Mum.');
    });
});
