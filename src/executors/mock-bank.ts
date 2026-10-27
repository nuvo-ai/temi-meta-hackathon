import type { ToolExecutor } from './types.js';

interface Beneficiary { nickname: string; name: string; account: string; phone: string; network: string }
interface Txn { id: string; kind: 'transfer' | 'airtime' | 'data'; amount: number; to: string; at: string }
interface Account { balance: number; pin: string; beneficiaries: Beneficiary[]; txns: Txn[] }

const DATA_PLANS: Record<string, Array<{ id: string; label: string; price: number }>> = {
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
};

function seedAccount(): Account {
    return {
        balance: 85_000,
        pin: '1234',
        beneficiaries: [
            { nickname: 'Mum', name: 'Folake Adeyemi', account: '0123456789', phone: '08031234567', network: 'mtn' },
            { nickname: 'Tunde', name: 'Tunde Bakare', account: '2234567890', phone: '08021234567', network: 'airtel' },
            { nickname: 'Aisha', name: 'Aisha Musa', account: '3034567891', phone: '08051234567', network: 'glo' },
        ],
        txns: [
            { id: 't-001', kind: 'transfer', amount: 10_000, to: 'Tunde Bakare', at: '2026-10-20T10:12:00Z' },
            { id: 't-002', kind: 'airtime', amount: 1_000, to: 'self', at: '2026-10-22T18:40:00Z' },
        ],
    };
}

/** An in-memory bank so the brain can be run and evaluated without touching real money. */
export class MockBank implements ToolExecutor {
    private accounts = new Map<string, Account>();
    private seq = 100;

    account(callerId: string): Account {
        let acct = this.accounts.get(callerId);
        if (!acct) {
            acct = seedAccount();
            this.accounts.set(callerId, acct);
        }
        return acct;
    }

    private findBeneficiary(acct: Account, recipient: string): Beneficiary | undefined {
        const r = recipient.trim().toLowerCase();
        return acct.beneficiaries.find(
            (b) => b.nickname.toLowerCase() === r || b.name.toLowerCase() === r || b.account === r || b.phone === r,
        );
    }

    async execute(name: string, args: Record<string, unknown>, { callerId }: { callerId: string }): Promise<unknown> {
        const acct = this.account(callerId);
        const amount = Number(args['amount_ngn']);
        const recipient = String(args['recipient'] ?? '');

        switch (name) {
            case 'get_balance':
                return { balance_ngn: acct.balance };

            case 'list_beneficiaries':
                return { beneficiaries: acct.beneficiaries.map(({ nickname, name }) => ({ nickname, name })) };

            case 'recent_transactions': {
                const limit = Number(args['limit']) || 3;
                return { transactions: acct.txns.slice(-limit).reverse() };
            }

            case 'verify_pin':
                return { verified: String(args['pin'] ?? '') === acct.pin };

            case 'send_money': {
                if (!(amount > 0)) return { status: 'failed', error: 'amount must be positive' };
                const b = this.findBeneficiary(acct, recipient);
                const isAccountNumber = /^\d{10}$/.test(recipient.trim());
                if (!b && !isAccountNumber) return { status: 'failed', error: `no saved beneficiary called "${recipient}"` };
                if (amount > acct.balance) return { status: 'failed', error: 'insufficient funds', balance_ngn: acct.balance };
                acct.balance -= amount;
                const to = b?.name ?? recipient.trim();
                const txn: Txn = { id: `t-${++this.seq}`, kind: 'transfer', amount, to, at: new Date().toISOString() };
                acct.txns.push(txn);
                return { status: 'success', reference: txn.id, to, amount_ngn: amount, balance_ngn: acct.balance };
            }

            case 'buy_airtime': {
                if (!(amount > 0)) return { status: 'failed', error: 'amount must be positive' };
                const self = recipient.toLowerCase() === 'self';
                const b = self ? undefined : this.findBeneficiary(acct, recipient);
                const isPhone = /^0\d{10}$/.test(recipient.trim());
                if (!self && !b && !isPhone) return { status: 'failed', error: `unknown recipient "${recipient}"` };
                if (amount > acct.balance) return { status: 'failed', error: 'insufficient funds', balance_ngn: acct.balance };
                acct.balance -= amount;
                const to = self ? 'self' : (b?.name ?? recipient.trim());
                acct.txns.push({ id: `t-${++this.seq}`, kind: 'airtime', amount, to, at: new Date().toISOString() });
                return { status: 'success', to, amount_ngn: amount, balance_ngn: acct.balance };
            }

            case 'list_data_plans': {
                const plans = DATA_PLANS[String(args['network'] ?? '').toLowerCase()];
                return plans ? { plans } : { error: 'unknown network' };
            }

            case 'buy_data': {
                const plan = Object.values(DATA_PLANS).flat().find((p) => p.id === args['plan_id']);
                if (!plan) return { status: 'failed', error: 'unknown plan_id' };
                const self = recipient.toLowerCase() === 'self';
                const b = self ? undefined : this.findBeneficiary(acct, recipient);
                if (!self && !b && !/^0\d{10}$/.test(recipient.trim())) return { status: 'failed', error: `unknown recipient "${recipient}"` };
                if (plan.price > acct.balance) return { status: 'failed', error: 'insufficient funds', balance_ngn: acct.balance };
                acct.balance -= plan.price;
                const to = self ? 'self' : (b?.name ?? recipient.trim());
                acct.txns.push({ id: `t-${++this.seq}`, kind: 'data', amount: plan.price, to, at: new Date().toISOString() });
                return { status: 'success', plan: plan.label, to, amount_ngn: plan.price, balance_ngn: acct.balance };
            }

            default:
                return { error: `unknown tool "${name}"` };
        }
    }
}
