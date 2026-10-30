import type { Country } from './countries.js';
import type { Tool } from './model.js';

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

/** The caller's tools, in their country's currency and networks. */
export function toolsFor(country: Country): Tool[] {
    const money = country.currency.name;
    const wallets = country.wallets.length ? `, or a ${country.wallets.join(' / ')} number` : '';
    return [
        fn('get_balance', `Get the caller's current account balance in ${money}.`, {}),
        fn('list_beneficiaries', 'List people the caller has sent money to before, with their nicknames.', {}),
        fn(
            'send_money',
            `Send ${money} to a saved beneficiary, a bank account${wallets}. Only call this after you have read the amount and recipient back to the caller and they clearly said yes.`,
            {
                recipient: { type: 'string', description: `Beneficiary nickname (e.g. "Mum"), bank account number${wallets ? ', or mobile money phone number' : ''}.` },
                amount: { type: 'number', description: `Amount in ${money}.` },
                narration: { type: 'string', description: 'Optional note for the transfer.' },
            },
            ['recipient', 'amount'],
        ),
        fn(
            'verify_pin',
            'Check the 4-digit Temi PIN the caller spoke. Use only when a transfer needs extra verification.',
            { pin: { type: 'string', description: 'Four digits.' } },
            ['pin'],
        ),
        fn(
            'buy_airtime',
            "Buy airtime for the caller's own number or for a beneficiary.",
            {
                amount: { type: 'number', description: `Amount in ${money}.` },
                recipient: { type: 'string', description: 'Beneficiary nickname, phone number, or "self".' },
            },
            ['amount', 'recipient'],
        ),
        fn(
            'list_data_plans',
            'List mobile data plans available for a network.',
            { network: { type: 'string', enum: country.networks.map((n) => n.id) } },
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
        fn(
            'set_reminder',
            'Remind the caller of something at a set time: Temi phones them then, says what it is, and they can act on it in that call.',
            {
                what: { type: 'string', description: "What to remind them of, in the caller's own language, with any amount and who it's for." },
                when: { type: 'string', description: 'The caller\'s local time, "YYYY-MM-DD HH:mm".' },
            },
            ['what', 'when'],
        ),
        fn('list_reminders', "List the caller's upcoming reminders.", {}),
        fn('cancel_reminder', 'Cancel one of the caller\'s reminders.', { id: { type: 'string', description: 'From list_reminders or set_reminder.' } }, ['id']),
    ];
}

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
