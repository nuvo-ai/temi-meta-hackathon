import { config } from './config.js';

export type CountryCode = 'NG' | 'KE' | 'GH' | 'TZ' | 'UG';

export interface Network {
    id: string;
    name: string;
}

/**
 * Everything the brain needs to serve callers in one country: how money is
 * named and moved, which networks exist, what the caller may speak, and which
 * scams are common there. Adding a country means adding one entry here plus
 * its mock-bank seed and eval cases.
 */
export interface Country {
    code: CountryCode;
    name: string;
    demonym: string;
    dialCode: string;
    currency: { code: string; name: string; locale: string };
    /** How amounts are said out loud, for the prompt. */
    sayAmounts: string;
    languages: string[];
    networks: Network[];
    /** Mobile money wallets callers can send to by phone number. Empty where bank transfer is the norm. */
    wallets: string[];
    /** Local phone number, e.g. 0803 123 4567 in Nigeria. */
    phone: RegExp;
    bankAccount: RegExp;
    /** Things Temi must never ask for, beyond its own PIN. */
    neverAsk: string[];
    guard: { stepUp: number; newRecipientStepUp: number };
    /** Scams common in this country, for the fraud check. */
    scams: string[];
    /** Who a pressured caller should call, in the caller's words. */
    helpLine: string;
}

export const COUNTRIES: Record<CountryCode, Country> = {
    NG: {
        code: 'NG',
        name: 'Nigeria',
        demonym: 'Nigerian',
        dialCode: '+234',
        currency: { code: 'NGN', name: 'naira', locale: 'en-NG' },
        sayAmounts: '"five thousand naira" ("₦5,000" and "5k" are fine too)',
        languages: ['English', 'Nigerian Pidgin', 'Yoruba', 'Hausa', 'Igbo'],
        networks: [
            { id: 'mtn', name: 'MTN' },
            { id: 'airtel', name: 'Airtel' },
            { id: 'glo', name: 'Glo' },
            { id: '9mobile', name: '9mobile' },
        ],
        wallets: [],
        phone: /^0\d{10}$/,
        bankAccount: /^\d{10}$/,
        neverAsk: ['card numbers', 'BVN', 'NIN', 'passwords'],
        guard: config.guard,
        scams: [
            'someone claiming to be from a bank, CBN, EFCC or the police asking for money to "unlock", "verify" or "reactivate" an account or BVN',
            'prize or "MTN anniversary promo" fees',
        ],
        helpLine: 'their bank',
    },
    KE: {
        code: 'KE',
        name: 'Kenya',
        demonym: 'Kenyan',
        dialCode: '+254',
        currency: { code: 'KES', name: 'shillings', locale: 'en-KE' },
        sayAmounts: '"two thousand shillings" (Kenyans also say "two thousand bob"; in Swahili, "shilingi elfu mbili")',
        languages: ['English', 'Swahili', 'Sheng'],
        networks: [
            { id: 'safaricom', name: 'Safaricom' },
            { id: 'airtel', name: 'Airtel' },
            { id: 'telkom', name: 'Telkom' },
        ],
        wallets: ['M-Pesa', 'Airtel Money'],
        phone: /^0[17]\d{8}$/,
        bankAccount: /^\d{10,14}$/,
        neverAsk: ['card numbers', 'M-Pesa PIN', 'ID number', 'passwords'],
        guard: { stepUp: 5_000, newRecipientStepUp: 1_000 },
        scams: [
            '"I sent you money by mistake, please send it back": a stranger asks the caller to "reverse" an M-Pesa payment, usually after a fake SMS',
            'someone claiming to be Safaricom or M-Pesa customer care asking for money or a PIN to "update", "unblock" or raise a Fuliza limit',
            'someone claiming to be from KRA, DCI, EACC or the police demanding a fine or penalty',
            'job, visa or loan offers that need a fee first',
        ],
        helpLine: 'their bank or Safaricom',
    },
    GH: {
        code: 'GH',
        name: 'Ghana',
        demonym: 'Ghanaian',
        dialCode: '+233',
        currency: { code: 'GHS', name: 'cedis', locale: 'en-GH' },
        sayAmounts: '"fifty cedis" (Twi: "sidi aduonum")',
        languages: ['English', 'Twi', 'Ghanaian Pidgin'],
        networks: [
            { id: 'mtn', name: 'MTN' },
            { id: 'telecel', name: 'Telecel' },
            { id: 'at', name: 'AT' },
        ],
        wallets: ['MTN MoMo', 'Telecel Cash', 'AT Money'],
        phone: /^0\d{9}$/,
        bankAccount: /^\d{11,16}$/,
        neverAsk: ['card numbers', 'MoMo PIN', 'Ghana Card number', 'passwords'],
        guard: { stepUp: 500, newRecipientStepUp: 100 },
        scams: [
            '"I sent you MoMo by mistake, please send it back": a stranger asks the caller to "reverse" a mobile money payment, usually after a fake SMS',
            'someone claiming to be MTN, Telecel or MoMo staff announcing a promo prize that needs a fee, or asking for money to "fix" a wallet',
            'someone claiming to be from the Bank of Ghana, EOCO or the police demanding money',
            'customs or "parcel" clearance fees for a gift from abroad',
        ],
        helpLine: 'their bank or mobile money provider',
    },
    TZ: {
        code: 'TZ',
        name: 'Tanzania',
        demonym: 'Tanzanian',
        dialCode: '+255',
        currency: { code: 'TZS', name: 'shillings', locale: 'en-TZ' },
        sayAmounts: '"twenty thousand shillings" (in Swahili, "shilingi elfu ishirini")',
        languages: ['Swahili', 'English'],
        networks: [
            { id: 'vodacom', name: 'Vodacom' },
            { id: 'airtel', name: 'Airtel' },
            { id: 'yas', name: 'Yas' },
            { id: 'halotel', name: 'Halotel' },
        ],
        wallets: ['M-Pesa', 'Mixx by Yas', 'Airtel Money', 'HaloPesa'],
        phone: /^0[67]\d{8}$/,
        bankAccount: /^\d{10,16}$/,
        neverAsk: ['card numbers', 'M-Pesa PIN', 'NIDA number', 'passwords'],
        guard: { stepUp: 100_000, newRecipientStepUp: 20_000 },
        scams: [
            '"ile pesa tuma kwa namba hii" ("send that money to this number instead"): an SMS or caller redirecting a payment the caller meant for someone else',
            '"I sent you money by mistake, please send it back": a stranger asks the caller to "reverse" a mobile money payment, usually after a fake SMS',
            'someone claiming to be Vodacom, M-Pesa or mobile money agent staff asking for money or a PIN to "fix" or "unblock" an account',
            'someone claiming to be from TRA or the police demanding a fine or penalty',
        ],
        helpLine: 'their bank or mobile money provider',
    },
    UG: {
        code: 'UG',
        name: 'Uganda',
        demonym: 'Ugandan',
        dialCode: '+256',
        currency: { code: 'UGX', name: 'shillings', locale: 'en-UG' },
        sayAmounts: '"twenty thousand shillings" (in Luganda, "emitwalo ebiri")',
        languages: ['English', 'Luganda', 'Swahili'],
        networks: [
            { id: 'mtn', name: 'MTN' },
            { id: 'airtel', name: 'Airtel' },
        ],
        // Bachs pays out in Uganda by bank transfer only, so Temi sends to bank accounts there.
        wallets: [],
        phone: /^07\d{8}$/,
        bankAccount: /^\d{11,16}$/,
        neverAsk: ['card numbers', 'mobile money PIN', 'NIN', 'passwords'],
        guard: { stepUp: 150_000, newRecipientStepUp: 30_000 },
        scams: [
            '"I sent you money by mistake, please send it back": a stranger asks the caller to "reverse" a payment, usually after a fake SMS',
            'someone claiming to be MTN or Airtel Money staff asking for money or a PIN to "fix" an account or release a prize',
            'someone claiming to be from URA or the police demanding a fine or penalty',
            'jobs abroad (often in the Middle East) that need a fee for visas, medicals or "processing"',
        ],
        helpLine: 'their bank',
    },
};

export const DEFAULT_COUNTRY = COUNTRIES.NG;

export function isCountryCode(code: unknown): code is CountryCode {
    return typeof code === 'string' && code in COUNTRIES;
}

/** Country of an international number (+254 712…, 254712…). Undefined for local or unsupported numbers. */
export function countryFromNumber(number: string | undefined): Country | undefined {
    const digits = (number ?? '').replace(/\D/g, '');
    return Object.values(COUNTRIES).find((c) => digits.length >= 11 && digits.startsWith(c.dialCode.slice(1)));
}

export function formatMoney(country: Country, amount: number): string {
    return new Intl.NumberFormat(country.currency.locale, {
        style: 'currency',
        currency: country.currency.code,
        maximumFractionDigits: 0,
    }).format(amount);
}
