export const REFERRAL_STORAGE_KEY = 'omt_referral_code';
export const REFERRAL_PUBLIC_ORIGIN = 'https://vastoptionmarkets.com';
const REFERRAL_CODE_PATTERN = /^[a-z0-9]{10}$/;

export type ReferralDeposit = {
  amount: number;
  completed_at: string;
  status: string;
  commission: number | null;
};

export type ReferredUser = {
  email: string;
  joined_at: string;
  deposit_total: number;
  commission_total: number;
  completed_deposits: ReferralDeposit[];
};

export type ReferralAdminSnapshot = {
  email: string;
  code: string;
  commission_total: number;
  wallet_balance: number;
  referred_users: ReferredUser[];
};

export type ReferralDashboard = {
  scope: 'all' | 'one';
  is_super_admin: boolean;
  own_code: string | null;
  admin?: ReferralAdminSnapshot;
  admins?: ReferralAdminSnapshot[];
};

export function normalizeReferralCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export function readReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  const code = normalizeReferralCode(window.localStorage.getItem(REFERRAL_STORAGE_KEY));
  if (!code) window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  return code;
}

export function rememberReferralCode(value: string | null | undefined): string | null {
  const incoming = normalizeReferralCode(value);
  if (typeof window === 'undefined') return incoming;
  if (!incoming) return readReferralCode();
  window.localStorage.setItem(REFERRAL_STORAGE_KEY, incoming);
  return incoming;
}

export function clearReferralCode() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
}

export function referralPath(code: string): string {
  return `/r/${code}`;
}

export function referralUrl(code: string, origin = REFERRAL_PUBLIC_ORIGIN): string {
  return `${origin.replace(/\/$/, '')}${referralPath(code)}`;
}

export function signupOptions(origin: string, code: string | null) {
  const referralCode = normalizeReferralCode(code);
  if (!referralCode) return { emailRedirectTo: origin };
  return { emailRedirectTo: origin, data: { referral_code: referralCode } };
}

export type ReferralLinkDecision =
  | { kind: 'signup' }
  | { kind: 'dashboard'; code: string }
  | { kind: 'own-wallet' }
  | { kind: 'trade' };

export function decideReferralLink(input: {
  loggedIn: boolean;
  code: string | null | undefined;
  access: string | null;
  canOpenOwnWallet: boolean;
}): ReferralLinkDecision {
  if (!input.loggedIn) return { kind: 'signup' };
  const code = normalizeReferralCode(input.code);
  if (code && (input.access === 'owner' || input.access === 'super')) {
    return { kind: 'dashboard', code };
  }
  if (input.canOpenOwnWallet) return { kind: 'own-wallet' };
  return { kind: 'trade' };
}

export function referralErrorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return error instanceof Error ? error.message : '';
}

export function referralAccessDenied(error: unknown): boolean {
  return /forbidden/i.test(referralErrorText(error));
}

function moneyNumber(value: unknown): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function optionalMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return moneyNumber(value);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type LooseRecord = {
  amount?: unknown;
  admin?: unknown;
  admins?: unknown;
  code?: unknown;
  commission?: unknown;
  commission_total?: unknown;
  status?: unknown;
  completed_at?: unknown;
  wallet_balance?: unknown;
  completed_deposits?: unknown;
  deposit_total?: unknown;
  email?: unknown;
  is_super_admin?: unknown;
  joined_at?: unknown;
  own_code?: unknown;
  referred_users?: unknown;
  scope?: unknown;
};

function looseRecord(value: unknown): LooseRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as LooseRecord;
}

function parseDeposit(value: unknown): ReferralDeposit | null {
  const row = looseRecord(value);
  if (!row) return null;
  const completedAt = textValue(row.completed_at);
  if (!completedAt) return null;
  return {
    amount: moneyNumber(row.amount),
    completed_at: completedAt,
    status: textValue(row.status) || 'completed',
    commission: optionalMoney(row.commission),
  };
}

function parseReferredUser(value: unknown): ReferredUser | null {
  const row = looseRecord(value);
  if (!row) return null;
  const email = textValue(row.email);
  const joinedAt = textValue(row.joined_at);
  if (!email || !joinedAt) return null;
  const deposits = Array.isArray(row.completed_deposits)
    ? row.completed_deposits.map(parseDeposit).filter((deposit): deposit is ReferralDeposit => deposit !== null)
    : [];
  return {
    email,
    joined_at: joinedAt,
    deposit_total: moneyNumber(row.deposit_total),
    commission_total: moneyNumber(row.commission_total),
    completed_deposits: deposits,
  };
}

function parseAdmin(value: unknown): ReferralAdminSnapshot | null {
  const row = looseRecord(value);
  if (!row) return null;
  const email = textValue(row.email);
  const code = normalizeReferralCode(textValue(row.code));
  if (!email || !code) return null;
  const users = Array.isArray(row.referred_users)
    ? row.referred_users.map(parseReferredUser).filter((user): user is ReferredUser => user !== null)
    : [];
  const commissionTotal = moneyNumber(row.commission_total);
  return {
    email,
    code,
    commission_total: commissionTotal,
    wallet_balance: row.wallet_balance == null ? commissionTotal : moneyNumber(row.wallet_balance),
    referred_users: users,
  };
}

export function parseReferralDashboard(value: unknown): ReferralDashboard {
  const row = looseRecord(value);
  if (!row) throw new Error('Referral dashboard could not be read.');
  const scope = row.scope === 'all' || row.scope === 'one' ? row.scope : null;
  if (!scope) throw new Error('Referral dashboard could not be read.');
  const ownCode = row.own_code == null ? null : normalizeReferralCode(textValue(row.own_code));
  const dashboard: ReferralDashboard = {
    scope,
    is_super_admin: row.is_super_admin === true,
    own_code: ownCode,
  };
  if (scope === 'one') {
    const admin = parseAdmin(row.admin);
    if (!admin) throw new Error('Referral dashboard could not be read.');
    dashboard.admin = admin;
  } else {
    dashboard.admins = Array.isArray(row.admins)
      ? row.admins.map(parseAdmin).filter((admin): admin is ReferralAdminSnapshot => admin !== null)
      : [];
  }
  return dashboard;
}

export function formatReferralUsd(amount: number): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
