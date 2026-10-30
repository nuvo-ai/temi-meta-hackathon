import { DEFAULT_COUNTRY, formatMoney, type Country } from './countries.js';
import type { Message, ModelClient } from './model.js';

export type GuardDecision = 'allow' | 'step_up' | 'block';

export interface GuardInput {
    tool: string;
    args: Record<string, unknown>;
    /** The conversation so far (system prompt excluded). */
    transcript: Message[];
    /** Recipient is already a saved beneficiary. */
    knownRecipient: boolean;
    /** Caller verified their PIN for this action. */
    verified: boolean;
    /** Caller's country: sets the currency, limits and which scams to look for. Defaults to Nigeria. */
    country?: Country;
}

export interface GuardResult {
    decision: GuardDecision;
    reasons: string[];
    source: 'rules' | 'model' | 'rules+model';
    latencyMs: number;
}

const SEVERITY: Record<GuardDecision, number> = { allow: 0, step_up: 1, block: 2 };
const worst = (a: GuardDecision, b: GuardDecision): GuardDecision => (SEVERITY[a] >= SEVERITY[b] ? a : b);

/** Fast, deterministic checks that don't need a model. */
export function ruleCheck(input: GuardInput): { decision: GuardDecision; reasons: string[] } {
    const country = input.country ?? DEFAULT_COUNTRY;
    const t = country.guard;
    const amount = Number(input.args['amount']) || 0;
    const reasons: string[] = [];
    let decision: GuardDecision = 'allow';

    if (amount >= t.stepUp) {
        decision = 'step_up';
        reasons.push(`amount ${formatMoney(country, amount)} is at or above the ${formatMoney(country, t.stepUp)} limit`);
    }
    if (!input.knownRecipient && input.tool === 'send_money' && amount >= t.newRecipientStepUp) {
        decision = 'step_up';
        reasons.push('first transfer to a new recipient');
    }
    return { decision, reasons };
}

const guardPrompt = (country: Country) => `You are a fraud analyst for a voice-banking and mobile-money service in ${country.name}. A caller is about to make a payment by phone. Amounts are in ${country.currency.name} (${country.currency.code}). Read the conversation and decide whether it should go ahead.

Look for:
- Coercion or urgency from someone else ("they said I must send it now", "the man on the other line…", a third voice giving instructions).
- Scams common in ${country.name}:
${country.scams.map((x) => `  - ${x}`).join('\n')}
- Scams seen everywhere: prize or lottery fees; romance or emergency-relative scams (a relative "arrested" or "in hospital"); investment "doubling".
- The caller sounding unsure, confused, or repeating words someone else is feeding them.
- The recipient or amount changing suddenly mid-call.
- The caller not clearly confirming the exact amount and recipient after Temi read them back.

Decide:
- "allow": ordinary request, clearly confirmed, no warning signs.
- "step_up": something is unusual but could be fine; require PIN verification.
- "block": strong signs of a scam or coercion.

Reply with JSON only: {"decision": "allow" | "step_up" | "block", "reasons": ["short reason", ...]}`;

function renderTranscript(transcript: Message[]): string {
    return transcript
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-20)
        .map((m) => `${m.role === 'user' ? 'Caller' : 'Temi'}: ${m.content as string}`)
        .join('\n');
}

export function guardMessages(input: GuardInput): Message[] {
    return [
        { role: 'system', content: guardPrompt(input.country ?? DEFAULT_COUNTRY) },
        {
            role: 'user',
            content: `Proposed action: ${input.tool} ${JSON.stringify(input.args)}\nRecipient already saved: ${input.knownRecipient ? 'yes' : 'no'}\n\nConversation:\n${renderTranscript(input.transcript)}`,
        },
    ];
}

export function parseVerdict(text: string): { decision: GuardDecision; reasons: string[] } | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]) as { decision?: string; reasons?: unknown };
        if (parsed.decision !== 'allow' && parsed.decision !== 'step_up' && parsed.decision !== 'block') return null;
        const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [];
        return { decision: parsed.decision, reasons };
    } catch {
        return null;
    }
}

/**
 * Runs before every money-moving tool. Rules and a Meta model each give a
 * verdict and the stricter one wins. If the model can't be reached, transfers
 * fail closed to step_up rather than going through unchecked.
 */
export class FraudGuard {
    constructor(
        private model?: ModelClient,
        private timeoutMs = 4_000,
    ) {}

    async check(input: GuardInput): Promise<GuardResult> {
        const started = Date.now();
        const rules = ruleCheck(input);
        let decision = rules.decision;
        const reasons = [...rules.reasons];
        let source: GuardResult['source'] = 'rules';

        if (this.model) {
            try {
                const { content } = await this.model.complete(guardMessages(input), AbortSignal.timeout(this.timeoutMs));
                const verdict = parseVerdict(content);
                if (!verdict) throw new Error('unparseable verdict');
                decision = worst(decision, verdict.decision);
                reasons.push(...verdict.reasons);
                source = rules.decision === 'allow' ? 'model' : 'rules+model';
            } catch (err) {
                decision = worst(decision, 'step_up');
                reasons.push(`fraud model unavailable (${err instanceof Error ? err.message : 'error'}), verifying instead`);
            }
        }

        // A verified PIN clears a step-up, never a block.
        if (decision === 'step_up' && input.verified) {
            decision = 'allow';
            reasons.push('caller verified PIN');
        }

        return { decision, reasons, source, latencyMs: Date.now() - started };
    }
}
