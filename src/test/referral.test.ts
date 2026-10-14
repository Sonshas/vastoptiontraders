import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReferralCode,
  normalizeReferralCode,
  parseReferralDashboard,
  readReferralCode,
  referralPath,
  referralUrl,
  rememberReferralCode,
  signupOptions,
} from '@/lib/referral';

const migration = readFileSync('drizzle/migrations/0013_referral_system.sql', 'utf8');
const adminRoles = readFileSync('drizzle/migrations/0012_additional_admin_roles.sql', 'utf8');
const bookmzizaAdmin = readFileSync('drizzle/migrations/0014_bookmziza_admin_role.sql', 'utf8');

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

  it('reads a referral dashboard without requiring user ids', () => {
    const dashboard = parseReferralDashboard({
      scope: 'one',
      is_super_admin: false,
      own_code: 'abc1234567',
      admin: {
        email: 'admin@example.com',
        code: 'abc1234567',
        commission_total: '3.00',
        referred_users: [{
          email: 'trader@example.com',
          joined_at: '2026-10-14T00:00:00.000Z',
          deposit_total: 10,
          commission_total: 3,
          completed_deposits: [{ amount: 10, completed_at: '2026-10-14T01:00:00.000Z', commission: 3 }],
        }],
      },
    });
    expect(dashboard.admin?.commission_total).toBe(3);
    expect(dashboard.admin?.referred_users[0]?.email).toBe('trader@example.com');
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
});
