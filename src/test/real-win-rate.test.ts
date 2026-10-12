import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWinRateInput, settlementRollWins, settlementWinRate } from '@/lib/practice-win-rate';

const root = dirname(fileURLToPath(import.meta.url));
const settlementSql = readFileSync(join(root, '../../drizzle/migrations/0008_real_win_rate.sql'), 'utf8');
const adminSource = readFileSync(join(root, '../routes/_authenticated/admin.tsx'), 'utf8');
const tradeSource = readFileSync(join(root, '../routes/_authenticated/trade.tsx'), 'utf8');

const realSettlement = settlementSql.slice(
  settlementSql.indexOf('FUNCTION public.place_real_trade'),
  settlementSql.indexOf('REVOKE EXECUTE ON FUNCTION public.place_real_trade'),
);

describe('real win rate', () => {
  it('defaults unset or invalid stored rates to 90 and keeps 0 and 100', () => {
    expect(settlementWinRate(null)).toBe(90);
    expect(settlementWinRate('')).toBe(90);
    expect(settlementWinRate('150')).toBe(90);
    expect(settlementWinRate('0')).toBe(0);
    expect(settlementWinRate('100')).toBe(100);
  });

  it('clamps a real-account entry and explains values that are not a number', () => {
    expect(parseWinRateInput('150', 'real')).toEqual({ ok: true, value: 100, clamped: true });
    expect(parseWinRateInput('-4', 'real')).toEqual({ ok: true, value: 0, clamped: true });
    expect(parseWinRateInput('90', 'real')).toEqual({ ok: true, value: 90, clamped: false });
    const invalid = parseWinRateInput('abc', 'real');
    const empty = parseWinRateInput(' ', 'real');
    expect(invalid).toEqual({ ok: false, message: 'Enter a real win rate from 0 to 100.' });
    expect(empty).toEqual({ ok: false, message: 'Enter a real win rate from 0 to 100.' });
  });

  it('makes a 0% rate lose and a 100% rate win', () => {
    expect(settlementRollWins(0, 0)).toBe(false);
    expect(settlementRollWins(0.5, 0)).toBe(false);
    expect(settlementRollWins(0, 100)).toBe(true);
    expect(settlementRollWins(0.999, 100)).toBe(true);
  });

  it('settles real trades from real_win_rate against completed funding and keeps the 90% quote', () => {
    expect(realSettlement).toContain("WHERE key = 'real_win_rate'");
    expect(realSettlement).not.toContain('practice_win_rate');
    expect(realSettlement).toContain('win_pct := 90');
    expect(realSettlement).toContain('random() < (win_pct / 100)');
    expect(realSettlement).not.toContain('random() < 0.9');
    expect(realSettlement).toContain('prob := 0.9');
    expect(realSettlement).toContain('pay := round(_stake * 0.95 / prob, 2)');
    expect(realSettlement).toContain("status = 'completed'");
    expect(realSettlement).toContain('FROM public.deposits');
    expect(realSettlement).toContain('FROM public.withdrawal_requests');
    expect(realSettlement).toContain('SUM(profit)');
    expect(realSettlement).toContain("RAISE EXCEPTION 'Insufficient real balance'");
    expect(realSettlement).toContain('SECURITY DEFINER');
    expect(realSettlement).toContain('INSERT INTO public.real_trades');
    expect(settlementSql).not.toContain('place_practice_trade');
    expect(settlementSql).toContain("key IS DISTINCT FROM 'real_win_rate'");
    expect(settlementSql).toContain("key IS DISTINCT FROM 'practice_win_rate'");
    expect(settlementSql).not.toContain('GRANT INSERT');
    expect(settlementSql).toContain('GRANT SELECT ON TABLE public.real_trades TO authenticated');
  });

  it('shows separate demo and real win-rate controls and sends real trades to place_real_trade', () => {
    expect(adminSource).toContain('aria-label="Demo win rate"');
    expect(adminSource).toContain('aria-label="Real win rate"');
    expect(adminSource).toContain('Save win rate');
    expect(adminSource).toContain('Save real win rate');
    expect(adminSource).toContain('newly settled Real account trades');
    expect(adminSource).toContain("parseWinRateInput(realWinValue, 'real')");
    expect(adminSource).toContain('REAL_WIN_RATE_KEY');
    expect(tradeSource).toContain("isReal ? 'place_real_trade' : 'place_practice_trade'");
    expect(tradeSource).toContain('Stake is more than your available real balance.');
    expect(tradeSource).not.toContain('Real trading is not available yet');
  });
});
