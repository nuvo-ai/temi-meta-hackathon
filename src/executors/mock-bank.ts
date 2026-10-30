import { COUNTRIES, type CountryCode } from '../countries.js';
import type { ToolExecutor, ToolContext } from './types.js';

interface Beneficiary {
    nickname: string;
    name: string;
    /** Bank account number, or empty when they're paid by mobile money. */
    account: string;
    phone: string;
    network: string;
    /** How money reaches them: "bank" or a wallet name such as "M-Pesa". */
    rail: string;
}
interface Txn { id: string; kind: 'transfer' | 'airtime' | 'data'; amount: number; to: string; at: string }
interface Account { balance: number; pin: string; beneficiaries: Beneficiary[]; txns: Txn[] }
type Plan = { id: string; label: string; price: number };

// Mock plans with roughly realistic prices; the real catalogue comes from Temi's telco partners.
const DATA_PLANS: Record<CountryCode, Record<string, Plan[]>> = {
    NG: {
        mtn: [
            { id: 'mtn-1gb-1d', label: '1GB for 1 day', price: 500 },
            { id: 'mtn-2gb-30d', label: '2GB for 30 days', price: 1500 },
            { id: 'mtn-10gb-30d', label: '10GB for 30 days', price: 4500 },
        ],
        airtel: [
            { id: 'airtel-1gb-1d', label: '1GB for 1 day', price: 500 },
            { id: 'airtel-3gb-30d', label: '3GB for 30 days', price: 2000 },
        ],
        glo: [{ id: 'glo-2.5gb-30d', label: '2.5GB for 30 days', price: 1000 }],
        '9mobile': [{ id: '9mobile-1.5gb-30d', label: '1.5GB for 30 days', price: 1000 }],
    },
    KE: {
        safaricom: [
            { id: 'safaricom-1gb-1d', label: '1GB for 1 day', price: 99 },
            { id: 'safaricom-2.5gb-7d', label: '2.5GB for 7 days', price: 300 },
            { id: 'safaricom-10gb-30d', label: '10GB for 30 days', price: 1000 },
        ],
        airtel: [
            { id: 'airtel-1gb-1d', label: '1GB for 1 day', price: 99 },
            { id: 'airtel-5gb-30d', label: '5GB for 30 days', price: 500 },
        ],
        telkom: [{ id: 'telkom-2gb-30d', label: '2GB for 30 days', price: 250 }],
    },
    GH: {
        mtn: [
            { id: 'mtn-1gb-1d', label: '1GB for 1 day', price: 5 },
            { id: 'mtn-2gb-30d', label: '2GB for 30 days', price: 20 },
            { id: 'mtn-10gb-30d', label: '10GB for 30 days', price: 80 },
        ],
        telecel: [{ id: 'telecel-1.5gb-30d', label: '1.5GB for 30 days', price: 15 }],
        at: [{ id: 'at-2gb-30d', label: '2GB for 30 days', price: 15 }],
    },
    TZ: {
        vodacom: [
            { id: 'vodacom-1gb-1d', label: '1GB for 1 day', price: 1_000 },
            { id: 'vodacom-3gb-7d', label: '3GB for 7 days', price: 5_000 },
            { id: 'vodacom-10gb-30d', label: '10GB for 30 days', price: 25_000 },
        ],
        airtel: [{ id: 'airtel-2gb-7d', label: '2GB for 7 days', price: 3_000 }],
        yas: [{ id: 'yas-5gb-30d', label: '5GB for 30 days', price: 15_000 }],
        halotel: [{ id: 'halotel-2gb-30d', label: '2GB for 30 days', price: 5_000 }],
    },
    UG: {
        mtn: [
            { id: 'mtn-1gb-1d', label: '1GB for 1 day', price: 2_000 },
            { id: 'mtn-3gb-30d', label: '3GB for 30 days', price: 15_000 },
        ],
        airtel: [{ id: 'airtel-2gb-7d', label: '2GB for 7 days', price: 5_000 }],
    },
};

const SEEDS: Record<CountryCode, () => Account> = {
    NG: () => ({
        balance: 85_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Folake Adeyemi', account: '0123456789', phone: '08031234567', network: 'mtn', rail: 'bank' },
            { nickname: 'Tunde', name: 'Tunde Bakare', account: '2234567890', phone: '08021234567', network: 'airtel', rail: 'bank' },
            { nickname: 'Aisha', name: 'Aisha Musa', account: '3034567891', phone: '08051234567', network: 'glo', rail: 'bank' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 10_000, to: 'Tunde Bakare', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 1_000, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    }),
    KE: () => ({
        balance: 25_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Wanjiku Kamau', account: '', phone: '0712345678', network: 'safaricom', rail: 'M-Pesa' },
            { nickname: 'Brian', name: 'Brian Otieno', account: '', phone: '0722123456', network: 'safaricom', rail: 'M-Pesa' },
            { nickname: 'Amina', name: 'Amina Hassan', account: '01234567890123', phone: '0733123456', network: 'airtel', rail: 'bank' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 1_500, to: 'Brian Otieno', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 100, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    }),
    GH: () => ({
        balance: 2_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Akosua Mensah', account: '', phone: '0244123456', network: 'mtn', rail: 'MTN MoMo' },
            { nickname: 'Kwame', name: 'Kwame Asante', account: '', phone: '0201234567', network: 'telecel', rail: 'Telecel Cash' },
            { nickname: 'Abena', name: 'Abena Owusu', account: '12345678901', phone: '0271234567', network: 'at', rail: 'bank' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 150, to: 'Kwame Asante', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 10, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    }),
    TZ: () => ({
        balance: 300_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Neema Mushi', account: '', phone: '0754123456', network: 'vodacom', rail: 'M-Pesa' },
            { nickname: 'Juma', name: 'Juma Mwinyi', account: '', phone: '0713123456', network: 'yas', rail: 'Mixx by Yas' },
            { nickname: 'Rehema', name: 'Rehema Said', account: '0150123456789', phone: '0684123456', network: 'airtel', rail: 'bank' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 20_000, to: 'Juma Mwinyi', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 2_000, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    }),
    // Bank only: Bachs doesn't pay out to mobile money in Uganda.
    UG: () => ({
        balance: 500_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Nakato Sarah', account: '9030012345678', phone: '0772123456', network: 'mtn', rail: 'bank' },
            { nickname: 'Ssali', name: 'Ssali Brian', account: '3100023456789', phone: '0701123456', network: 'airtel', rail: 'bank' },
            { nickname: 'Aisha', name: 'Aisha Nabukenya', account: '0140034567890', phone: '0782123456', network: 'mtn', rail: 'bank' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 50_000, to: 'Ssali Brian', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 5_000, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    }),
};

/** An in-memory bank so the brain can be run and evaluated without touching real money. */
export class MockBank implements ToolExecutor {
    private accounts = new Map<string, Account>();
    private seq = 100;

    account(callerId: string, country: CountryCode = 'NG'): Account {
        const key = `${country}:${callerId}`;
        let acct = this.accounts.get(key);
        if (!acct) {
            acct = SEEDS[country]();
            this.accounts.set(key, acct);
        }
        return acct;
    }

    private findBeneficiary(acct: Account, recipient: string): Beneficiary | undefined {
        const r = recipient.trim().toLowerCase();
        return acct.beneficiaries.find(
            (b) => b.nickname.toLowerCase() === r || b.name.toLowerCase() === r || (b.account && b.account === r) || b.phone === r,
        );
    }

    async execute(name: string, args: Record<string, unknown>, { callerId, country: code = 'NG' }: ToolContext): Promise<unknown> {
        const country = COUNTRIES[code];
        const currency = country.currency.code;
        const acct = this.account(callerId, code);
        const amount = Number(args['amount']);
        const recipient = String(args['recipient'] ?? '');
        const plans = DATA_PLANS[code];
        const isPhone = country.phone.test(recipient.trim());

        switch (name) {
            case 'get_balance':
                return { balance: acct.balance, currency };

            case 'list_beneficiaries':
                return { beneficiaries: acct.beneficiaries.map(({ nickname, name, rail }) => ({ nickname, name, paid_by: rail })) };

            case 'recent_transactions': {
                const limit = Number(args['limit']) || 3;
                return { transactions: acct.txns.slice(-limit).reverse(), currency };
            }

            case 'verify_pin':
                return { verified: String(args['pin'] ?? '') === acct.pin };

            case 'send_money': {
                if (!(amount > 0)) return { status: 'failed', error: 'amount must be positive' };
                const b = this.findBeneficiary(acct, recipient);
                // A phone number is a mobile money wallet where wallets exist; check it before bank accounts, which can be the same length.
                const rail = b?.rail ?? (country.wallets.length && isPhone ? 'mobile money' : country.bankAccount.test(recipient.trim()) ? 'bank' : undefined);
                if (!rail && isPhone) return { status: 'failed', error: `sending to mobile money isn't available in ${country.name} yet; ask for a bank account number` };
                if (!rail) return { status: 'failed', error: `no saved beneficiary, account or wallet "${recipient}"` };
                if (amount > acct.balance) return { status: 'failed', error: 'insufficient funds', balance: acct.balance, currency };
                acct.balance -= amount;
                const to = b?.name ?? recipient.trim();
                const txn: Txn = { id: `t-${++this.seq}`, kind: 'transfer', amount, to, at: new Date().toISOString() };
                acct.txns.push(txn);
                return { status: 'success', reference: txn.id, to, via: rail, amount, balance: acct.balance, currency };
            }

            case 'buy_airtime': {
                if (!(amount > 0)) return { status: 'failed', error: 'amount must be positive' };
                const self = recipient.toLowerCase() === 'self';
                const b = self ? undefined : this.findBeneficiary(acct, recipient);
                if (!self && !b && !isPhone) return { status: 'failed', error: `unknown recipient "${recipient}"` };
                if (amount > acct.balance) return { status: 'failed', error: 'insufficient funds', balance: acct.balance, currency };
                acct.balance -= amount;
                const to = self ? 'self' : (b?.name ?? recipient.trim());
                acct.txns.push({ id: `t-${++this.seq}`, kind: 'airtime', amount, to, at: new Date().toISOString() });
                return { status: 'success', to, amount, balance: acct.balance, currency };
            }

            case 'list_data_plans': {
                const found = plans[String(args['network'] ?? '').toLowerCase()];
                return found ? { plans: found, currency } : { error: `unknown network in ${country.name}` };
            }

            case 'buy_data': {
                const plan = Object.values(plans).flat().find((p) => p.id === args['plan_id']);
                if (!plan) return { status: 'failed', error: 'unknown plan_id' };
                const self = recipient.toLowerCase() === 'self';
                const b = self ? undefined : this.findBeneficiary(acct, recipient);
                if (!self && !b && !isPhone) return { status: 'failed', error: `unknown recipient "${recipient}"` };
                if (plan.price > acct.balance) return { status: 'failed', error: 'insufficient funds', balance: acct.balance, currency };
                acct.balance -= plan.price;
                const to = self ? 'self' : (b?.name ?? recipient.trim());
                acct.txns.push({ id: `t-${++this.seq}`, kind: 'data', amount: plan.price, to, at: new Date().toISOString() });
                return { status: 'success', plan: plan.label, to, amount: plan.price, balance: acct.balance, currency };
            }

            default:
                return { error: `unknown tool "${name}"` };
        }
    }
}
