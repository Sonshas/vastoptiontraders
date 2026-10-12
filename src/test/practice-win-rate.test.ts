import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { digitSatisfiesContract, digitsMatchingOutcome, parseWinRateInput, practiceTradeWins, settlementWinRate } from '@/lib/practice-win-rate';

const root = dirname(fileURLToPath(import.meta.url));
const settlementSql = readFileSync(join(root, '../../drizzle/migrations/0007_practice_win_rate.sql'), 'utf8');
const forcedSql = readFileSync(join(root, '../../drizzle/migrations/0009_force_win_rate.sql'), 'utf8');
const practiceSettlement = forcedSql.slice(
  forcedSql.indexOf('FUNCTION public.place_practice_trade'),
  forcedSql.indexOf('REVOKE EXECUTE ON FUNCTION public.place_practice_trade'),
);

describe('practice win rate', () => {
  it('defaults unset or invalid stored rates to 90 and keeps 0 and 100', () => {
    expect(settlementWinRate(null)).toBe(90);
    expect(settlementWinRate(undefined)).toBe(90);
    expect(settlementWinRate('')).toBe(90);
    expect(settlementWinRate('nope')).toBe(90);
    expect(settlementWinRate('150')).toBe(90);
    expect(settlementWinRate(-1)).toBe(90);
    expect(settlementWinRate('0')).toBe(0);
    expect(settlementWinRate('100')).toBe(100);
    expect(settlementWinRate(' 90.5 ')).toBe(90.5);
  });

  it('clamps an admin entry to 0–100 and explains values that are not a number', () => {
    expect(parseWinRateInput('150')).toEqual({ ok: true, value: 100, clamped: true });
    expect(parseWinRateInput('-4')).toEqual({ ok: true, value: 0, clamped: true });
    expect(parseWinRateInput('90')).toEqual({ ok: true, value: 90, clamped: false });
    const invalid = parseWinRateInput('abc');
    const empty = parseWinRateInput('');
    expect(invalid.ok).toBe(false);
    expect(empty.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toMatch(/0 to 100/);
    if (!empty.ok) expect(empty.message).toMatch(/0 to 100/);
  });

  it('makes a 0% rate lose and a 100% rate win', () => {
    expect(practiceTradeWins(0, 0)).toBe(false);
    expect(practiceTradeWins(0.5, 0)).toBe(false);
    expect(practiceTradeWins(1, 0)).toBe(false);
    expect(practiceTradeWins(0, 100)).toBe(true);
    expect(practiceTradeWins(0.999, 100)).toBe(true);
    expect(practiceTradeWins(1, 100)).toBe(true);
    expect(practiceTradeWins(0.89, 90)).toBe(true);
    expect(practiceTradeWins(0.9, 90)).toBe(false);
    expect(practiceTradeWins(0.2, 'not-a-rate')).toBe(true);
  });

  it('picks an exit digit that agrees with a forced win or loss', () => {
    const contracts: { contract: string; barrier: number }[] = [
      { contract: 'EVEN', barrier: 0 },
      { contract: 'ODD', barrier: 0 },
      { contract: 'MATCHES', barrier: 5 },
      { contract: 'DIFFERS', barrier: 3 },
      { contract: 'OVER', barrier: 8 },
      { contract: 'UNDER', barrier: 1 },
    ];
    for (const { contract, barrier } of contracts) {
      for (const won of [true, false]) {
        const digits = digitsMatchingOutcome(contract, barrier, won);
        expect(digits.length).toBeGreaterThan(0);
        for (const digit of digits) {
          expect(digitSatisfiesContract(contract, barrier, digit)).toBe(won);
        }
      }
    }
    expect(digitsMatchingOutcome('MATCHES', 5, true)).toEqual([5]);
    expect(digitsMatchingOutcome('DIFFERS', 3, false)).toEqual([3]);
    expect(digitsMatchingOutcome('OVER', 8, true)).toEqual([9]);
    expect(digitsMatchingOutcome('UNDER', 1, true)).toEqual([0]);
    expect(digitsMatchingOutcome('OVER', 9, true)).toEqual([]);
  });

  it('makes settlement read practice_win_rate instead of a fixed 90% roll', () => {
    expect(settlementSql).toContain("WHERE key = 'practice_win_rate'");
    expect(settlementSql).toContain("key IS DISTINCT FROM 'practice_win_rate'");
    expect(practiceSettlement).toContain("WHERE key = 'practice_win_rate'");
    expect(practiceSettlement).not.toContain('real_win_rate');
    expect(practiceSettlement).toContain('win_pct := 90');
    expect(practiceSettlement).toContain('IF win_pct >= 100 THEN');
    expect(practiceSettlement).toContain('w := true');
    expect(practiceSettlement).toContain('ELSIF win_pct <= 0 THEN');
    expect(practiceSettlement).toContain('w := false');
    expect(practiceSettlement).toContain('ELSIF random() < (win_pct / 100.0) THEN');
    expect(practiceSettlement).not.toContain('IF random() < (win_pct / 100) THEN');
    expect(practiceSettlement).not.toContain('random() < 0.9');
    expect(practiceSettlement).not.toContain('w := CASE');
    expect(practiceSettlement).toContain('candidates := candidates || cand');
    expect(practiceSettlement).toContain('prob := 0.9');
    expect(practiceSettlement).toContain('pay := round(_stake * 0.95 / prob, 2)');
  });
});
