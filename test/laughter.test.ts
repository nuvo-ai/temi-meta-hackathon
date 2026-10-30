import { describe, expect, it } from 'vitest';
import { LaughGate, MAX_LAUGHS_PER_CALL, splitLaughs, withoutLaughs } from '../src/laughter.js';
import type { Message } from '../src/model.js';

const reply = (content: string): Message => ({ role: 'assistant', content });

describe('laughter', () => {
    it('keeps one laugh per reply and drops other stage directions', () => {
        const gate = new LaughGate([]);
        expect(gate.filter('[Chuckle] Your goat has expensive taste! [laugh] Wow.')).toBe('[chuckle] Your goat has expensive taste! Wow.');
        expect(gate.filter('[smiles] Anything else?')).toBe('Anything else?');
    });

    it('never laughs once money was stopped or needs checking', () => {
        const gate = new LaughGate([]);
        gate.noteToolResult({ status: 'blocked', reasons: ['bail scam'] });
        expect(gate.filter("[chuckle] I couldn't send that.")).toBe("I couldn't send that.");
    });

    it('never laughs two replies running, and stops at the per-call limit', () => {
        expect(new LaughGate([reply('[laugh] That is funny!')]).filter('[chuckle] Ha.')).toBe('Ha.');
        const full = Array.from({ length: MAX_LAUGHS_PER_CALL }, () => [reply('[chuckle] Nice.'), reply('Okay.')]).flat();
        expect(new LaughGate(full).filter('[laugh] Again!')).toBe('Again!');
        expect(new LaughGate([reply('[chuckle] Nice.'), reply('Okay.')]).filter('[laugh] Again!')).toBe('[laugh] Again!');
    });

    it('splits a reply into speech and laughs for the phone line', () => {
        expect(splitLaughs('[chuckle] Good thing you checked. Shall I send it?')).toEqual([{ laugh: 'chuckle' }, { say: 'Good thing you checked. Shall I send it?' }]);
        expect(withoutLaughs('[laugh] Congratulations!')).toBe('Congratulations!');
    });
});
