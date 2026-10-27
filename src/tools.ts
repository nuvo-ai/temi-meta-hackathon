import type { Tool } from './model.js';

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const TOOLS: Tool[] = [
    fn('get_balance', "Get the caller's current account balance in naira.", {}),
    fn('list_beneficiaries', 'List people the caller has sent money to before, with their nicknames.', {}),
    fn(
        'send_money',
        'Send naira to a saved beneficiary or a bank account. Only call this after you have read the amount and recipient back to the caller and they clearly said yes.',
        {
            recipient: { type: 'string', description: 'Beneficiary nickname (e.g. "Mum") or account number.' },
            amount_ngn: { type: 'number', description: 'Amount in naira.' },
            narration: { type: 'string', description: 'Optional note for the transfer.' },
        },
        ['recipient', 'amount_ngn'],
    ),
    fn(
        'verify_pin',
        'Check the 4-digit PIN the caller spoke. Use only when a transfer needs extra verification.',
        { pin: { type: 'string', description: 'Four digits.' } },
        ['pin'],
    ),
    fn(
        'buy_airtime',
        "Buy airtime for the caller's own number or for a beneficiary.",
        {
            amount_ngn: { type: 'number' },
            recipient: { type: 'string', description: 'Beneficiary nickname, phone number, or "self".' },
        },
        ['amount_ngn', 'recipient'],
    ),
    fn(
        'list_data_plans',
        'List mobile data plans available for a network.',
        { network: { type: 'string', enum: ['mtn', 'airtel', 'glo', '9mobile'] } },
        ['network'],
    ),
    fn(
        'buy_data',
        'Buy a data plan by plan id for the caller or a beneficiary.',
        {
            plan_id: { type: 'string' },
            recipient: { type: 'string', description: 'Beneficiary nickname, phone number, or "self".' },
        },
        ['plan_id', 'recipient'],
    ),
    fn('recent_transactions', "List the caller's most recent transactions.", {
        limit: { type: 'number', description: 'How many, default 3.' },
    }),
];

/** Tools that move money and must pass the fraud check first. */
export const MONEY_TOOLS = new Set(['send_money', 'buy_airtime', 'buy_data']);

/** Tools that hit a bank or telco, so the call server should play a filler. */
export const SLOW_TOOLS = new Set(['get_balance', 'send_money', 'buy_airtime', 'buy_data', 'list_data_plans', 'recent_transactions']);

/** Arguments never logged or sent back to the call server in events. */
export const SECRET_ARGS: Record<string, string[]> = { verify_pin: ['pin'] };

export function redactArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const secret = SECRET_ARGS[name];
    if (!secret) return args;
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, secret.includes(k) ? '****' : v]));
}
