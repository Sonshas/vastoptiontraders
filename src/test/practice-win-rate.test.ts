import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWinRateInput, practiceTradeWins, settlementWinRate } from '@/lib/practice-win-rate';

const settlementSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../drizzle/migrations/0007_practice_win_rate.sql'),
  'utf8',
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
    expect(practiceTradeWins(0, 100)).toBe(true);
    expect(practiceTradeWins(0.999, 100)).toBe(true);
    expect(practiceTradeWins(0.89, 90)).toBe(true);
    expect(practiceTradeWins(0.9, 90)).toBe(false);
    expect(practiceTradeWins(0.2, 'not-a-rate')).toBe(true);
  });

  it('makes settlement read practice_win_rate instead of a fixed 90% roll', () => {
    expect(settlementSql).toContain("WHERE key = 'practice_win_rate'");
    expect(settlementSql).toContain('win_pct := 90');
    expect(settlementSql).toContain('random() < (win_pct / 100)');
    expect(settlementSql).not.toContain('random() < 0.9');
    expect(settlementSql).toContain("key IS DISTINCT FROM 'practice_win_rate'");
  });
});
