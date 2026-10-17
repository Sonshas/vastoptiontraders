import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReferralCode,
  normalizeReferralCode,
  decideReferralLink,
  parseReferralDashboard,
  readReferralCode,
  referralAccessDenied,
  referralPath,
  referralUrl,
  rememberReferralCode,
  signupOptions,
} from '@/lib/referral';

const migration = readFileSync('drizzle/migrations/0013_referral_system.sql', 'utf8');
const adminRoles = readFileSync('drizzle/migrations/0012_additional_admin_roles.sql', 'utf8');
const bookmzizaAdmin = readFileSync('drizzle/migrations/0014_bookmziza_admin_role.sql', 'utf8');
const referrerWallets = readFileSync('drizzle/migrations/0015_referrer_wallets.sql', 'utf8');
const referrerAdmins = readFileSync('drizzle/migrations/0016_referrer_admin_roles.sql', 'utf8');
const adminSuperAccess = readFileSync('drizzle/migrations/0017_admin_superadmin_access.sql', 'utf8');
const restrictSuperAdmin = readFileSync('drizzle/migrations/0018_restrict_superadmin_referral.sql', 'utf8');

describe('referral links', () => {
  beforeEach(() => localStorage.clear());

  it('stores a well-formed code and ignores invalid ones', () => {
    expect(normalizeReferralCode('AbC1234567')).toBe('abc1234567');
    expect(normalizeReferralCode('short')).toBeNull();
    expect(normalizeReferralCode('../admin12')).toBeNull();
    expect(rememberReferralCode('not a code')).toBeNull();
    expect(localStorage.getItem('omt_referral_code')).toBeNull();
    expect(rememberReferralCode('ABC1234567')).toBe('abc1234567');
    expect(readReferralCode()).toBe('abc1234567');
    expect(rememberReferralCode('bad')).toBe('abc1234567');
    clearReferralCode();
    expect(readReferralCode()).toBeNull();
  });

  it('builds a public referral path and omits signup metadata when there is no code', () => {
    expect(referralPath('abc1234567')).toBe('/r/abc1234567');
    expect(referralUrl('abc1234567')).toBe('https://vastoptionmarkets.com/r/abc1234567');
    expect(signupOptions('https://vastoptionmarkets.com', null)).toEqual({
      emailRedirectTo: 'https://vastoptionmarkets.com',
    });
    expect(signupOptions('https://vastoptionmarkets.com', 'nope')).toEqual({
      emailRedirectTo: 'https://vastoptionmarkets.com',
    });
    expect(signupOptions('https://vastoptionmarkets.com', 'ABC1234567')).toEqual({
      emailRedirectTo: 'https://vastoptionmarkets.com',
      data: { referral_code: 'abc1234567' },
    });
  });

  it('sends a logged-in visitor away from another referral wallet', () => {
    expect(decideReferralLink({ loggedIn: false, code: 'abc1234567', access: null, canOpenOwnWallet: false })).toEqual({ kind: 'signup' });
    expect(decideReferralLink({ loggedIn: true, code: 'abc1234567', access: 'owner', canOpenOwnWallet: true })).toEqual({ kind: 'dashboard', code: 'abc1234567' });
    expect(decideReferralLink({ loggedIn: true, code: 'abc1234567', access: 'super', canOpenOwnWallet: true })).toEqual({ kind: 'dashboard', code: 'abc1234567' });
    expect(decideReferralLink({ loggedIn: true, code: 'abc1234567', access: 'none', canOpenOwnWallet: true })).toEqual({ kind: 'own-wallet' });
    expect(decideReferralLink({ loggedIn: true, code: 'abc1234567', access: null, canOpenOwnWallet: true })).toEqual({ kind: 'own-wallet' });
    expect(decideReferralLink({ loggedIn: true, code: 'abc1234567', access: 'none', canOpenOwnWallet: false })).toEqual({ kind: 'trade' });
    expect(referralAccessDenied({ message: 'Forbidden' })).toBe(true);
    expect(referralAccessDenied({ message: 'Referral code not found' })).toBe(false);
  });

  it('reads a referral dashboard without requiring user ids', () => {
    const dashboard = parseReferralDashboard({
      scope: 'one',
      is_super_admin: false,
      own_code: 'abc1234567',
      admin: {
        email: 'admin@example.com',
        code: 'abc1234567',
        commission_total: '3.00',
        wallet_balance: '3.00',
        referred_users: [{
          email: 'trader@example.com',
          joined_at: '2026-10-14T00:00:00.000Z',
          deposit_total: 10,
          commission_total: 3,
          completed_deposits: [
            { amount: 10, completed_at: '2026-10-14T01:00:00.000Z', commission: 3 },
            { amount: 12.4, completed_at: '2026-10-16T13:25:00.000Z', status: 'rejected', commission: null },
          ],
        }],
      },
    });
    expect(dashboard.admin?.commission_total).toBe(3);
    expect(dashboard.admin?.wallet_balance).toBe(3);
    expect(dashboard.admin?.referred_users[0]?.email).toBe('trader@example.com');
    expect(dashboard.admin?.referred_users[0]?.completed_deposits[0]?.status).toBe('completed');
    expect(dashboard.admin?.referred_users[0]?.completed_deposits[1]?.status).toBe('rejected');
    const legacy = parseReferralDashboard({
      scope: 'one',
      is_super_admin: false,
      own_code: 'abc1234567',
      admin: {
        email: 'admin@example.com',
        code: 'abc1234567',
        commission_total: 4,
        referred_users: [],
      },
    });
    expect(legacy.admin?.wallet_balance).toBe(4);
    expect(parseReferralDashboard({ scope: 'all', is_super_admin: true, own_code: null, admins: [] }).admins).toEqual([]);
    expect(() => parseReferralDashboard({ scope: 'one' })).toThrow(/could not be read/);
  });
});

describe('referral migration', () => {
  it('records 30 percent once when a deposit completes and leaves admin grants in place', () => {
    expect(migration).not.toMatch(/assign_admin_role/);
    expect(migration).toContain('round(NEW.amount * 0.30, 2)');
    expect(migration).toContain("NEW.status IS DISTINCT FROM 'completed'");
    expect(migration).toContain('ON CONFLICT (deposit_id) DO NOTHING');
    expect(migration).toContain('sonshasopunga@gmail.com');
    const emails = migration.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    expect(new Set(emails)).toEqual(new Set(['sonshasopunga@gmail.com']));
    const insertAt = migration.indexOf('INSERT INTO public.referral_commissions');
    const conflictAt = migration.indexOf('ON CONFLICT (deposit_id)', insertAt);
    expect(migration.slice(insertAt, conflictAt)).not.toMatch(/deposits/i);
    expect(adminRoles).toContain('sonshasopunga@gmail.com');
    expect(adminRoles).toContain('jdey6396@gmail.com');
    expect(adminRoles).toContain('modifrayk@gmail.com');
    expect(adminRoles).toContain('domondi797@gmail.com');
    for (const email of [
      'domondi797@gmail.com',
      'sonshasopunga@gmail.com',
      'jdey6396@gmail.com',
      'modifrayk@gmail.com',
      'bookmzizafamily254@gmail.com',
    ]) {
      expect(bookmzizaAdmin).toContain(email);
    }
    expect(bookmzizaAdmin).not.toMatch(/is_super_admin/);
    expect(bookmzizaAdmin).toContain('ON CONFLICT (admin_id) DO NOTHING');
  });

  it('opens referral wallets for designated referrers without an admin role', () => {
    expect(referrerWallets).toContain('cleverserugo@gmail.com');
    expect(referrerWallets).toContain('gipsonotengo@gmail.com');
    expect(referrerWallets).toContain('ON CONFLICT (admin_id) DO NOTHING');
    expect(referrerWallets).toContain("'wallet_balance', wallet.balance");
    expect(referrerWallets).toContain("'commission_total', wallet.balance");
    expect(referrerWallets).toContain('round(sum(c.commission_amount), 2)');
    expect(referrerWallets).not.toMatch(/INSERT INTO public\.user_roles/);
    expect(referrerWallets).not.toMatch(/INSERT INTO public\.referral_commissions/);
    expect(referrerWallets).not.toMatch(/FUNCTION public\.is_super_admin/);
    const captureAt = referrerWallets.indexOf('FUNCTION public.capture_signup_referral');
    const ensureAt = referrerWallets.indexOf('FUNCTION public.ensure_designated_referrer');
    const capture = referrerWallets.slice(captureAt, ensureAt);
    expect(capture).not.toContain('has_role');
    expect(capture).toContain('ON CONFLICT (referred_user_id) DO NOTHING');
    expect(capture).toContain("raw_code !~ '^[a-z0-9]{10}$'");
  });

  it('grants admin to the designated referrers without replacing their codes', () => {
    for (const email of [
      'domondi797@gmail.com',
      'sonshasopunga@gmail.com',
      'jdey6396@gmail.com',
      'modifrayk@gmail.com',
      'bookmzizafamily254@gmail.com',
      'cleverserugo@gmail.com',
      'gipsonotengo@gmail.com',
    ]) {
      expect(referrerAdmins).toContain(email);
    }
    expect(referrerAdmins).toContain('ON CONFLICT DO NOTHING');
    expect(referrerAdmins).not.toMatch(/is_super_admin/);
    expect(referrerAdmins).not.toMatch(/referral_codes/);
    expect(referrerAdmins).not.toMatch(/referral_commissions/);
    expect(referrerAdmins).not.toMatch(/generate_referral_code/);
  });

  it('gives every admin the superadmin referral view without rewriting codes', () => {
    expect(adminSuperAccess).toContain('FUNCTION public.is_super_admin');
    expect(adminSuperAccess).toContain("public.has_role(_user_id, 'admin')");
    expect(adminSuperAccess).not.toMatch(/@/);
    expect(adminSuperAccess).not.toMatch(/referral_codes/);
    expect(adminSuperAccess).not.toMatch(/referral_commissions/);
    expect(adminSuperAccess).not.toMatch(/generate_referral_code/);
    expect(adminSuperAccess).not.toMatch(/INSERT INTO/);
    expect(adminSuperAccess).not.toMatch(/is_referrer/);
  });

  it('limits the superadmin referral view to one email without rewriting wallets', () => {
    expect(restrictSuperAdmin).toContain('FUNCTION public.is_super_admin');
    expect(restrictSuperAdmin).toContain("lower(email) = 'sonshasopunga@gmail.com'");
    expect(restrictSuperAdmin).not.toContain("public.has_role(_user_id, 'admin')");
    expect(restrictSuperAdmin).toContain('admin_id = auth.uid() OR public.is_super_admin(auth.uid())');
    expect(restrictSuperAdmin).toContain('referrer_admin_id = auth.uid()');
    expect(restrictSuperAdmin).toContain('GRANT SELECT ON TABLE public.referral_codes TO authenticated');
    expect(restrictSuperAdmin).not.toMatch(/GRANT INSERT|GRANT UPDATE|FOR INSERT|FOR UPDATE|FOR DELETE/i);
    expect(restrictSuperAdmin).not.toMatch(/INSERT INTO/);
    expect(restrictSuperAdmin).not.toMatch(/referral_commissions \(/);
    expect(restrictSuperAdmin).not.toMatch(/generate_referral_code/);
    expect(restrictSuperAdmin).not.toMatch(/user_roles/);
    const emails = restrictSuperAdmin.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    expect(new Set(emails)).toEqual(new Set(['sonshasopunga@gmail.com']));
  });
});
