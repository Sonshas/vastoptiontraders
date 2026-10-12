import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAYOUT_CONTRACTS, PAYOUT_MARKETS, quotedPayout, settledWin, winningProfit } from '@/lib/payout';

const root = dirname(fileURLToPath(import.meta.url));
const payoutSql = readFileSync(join(root, '../../drizzle/migrations/0010_ninety_percent_profit.sql'), 'utf8');
const tradeSource = readFileSync(join(root, '../routes/_authenticated/trade.tsx'), 'utf8');

function settlementBody(name: 'place_practice_trade' | 'place_real_trade'): string {
  const start = payoutSql.indexOf(`FUNCTION public.${name}`);
  const end = payoutSql.indexOf(`REVOKE EXECUTE ON FUNCTION public.${name}`);
  return payoutSql.slice(start, end);
}

describe('ninety percent profit', () => {
  it('returns exactly 90% of stake as profit on every contract and volatility', () => {
    const stakes = [10, 25, 100];
    expect(PAYOUT_MARKETS.length).toBeGreaterThan(1);
    expect(PAYOUT_CONTRACTS.length).toBeGreaterThan(1);
    for (const market of PAYOUT_MARKETS) {
      for (const contract of PAYOUT_CONTRACTS) {
        for (const stake of stakes) {
          const settled = settledWin(market, contract, stake);
          expect(settled.profit).toBe(stake * 0.9);
          expect(settled.payout).toBe(stake + settled.profit);
          expect(winningProfit(stake)).toBe(stake * 0.9);
          expect(quotedPayout(stake)).toBe(stake * 1.9);
        }
      }
    }
    expect(settledWin('R_10', 'OVER', 10)).toEqual({ payout: 19, profit: 9 });
    expect(settledWin('R_100', 'DIFFERS', 10)).toEqual({ payout: 19, profit: 9 });
    expect(settledWin('R_50', 'EVEN', 10)).toEqual({ payout: 19, profit: 9 });
  });

  it('quotes the same return on the ticket that settlement credits', () => {
    expect(tradeSource).toContain('quotedPayout(stakeNum)');
    expect(tradeSource).not.toContain('0.95');
    expect(quotedPayout(10)).toBe(19);
    expect(winningProfit(10)).toBe(9);
  });

  it('settles demo and real wins at stake plus 90% and still forces 0 and 100', () => {
    for (const name of ['place_practice_trade', 'place_real_trade'] as const) {
      const body = settlementBody(name);
      expect(body).toContain('pay := _stake + round(_stake * 0.90, 2)');
      expect(body).toContain('prof := CASE WHEN w THEN pay - _stake ELSE -_stake END');
      expect(body).not.toContain('0.95');
      expect(body).not.toContain('prob');
      expect(body).toContain('IF win_pct >= 100 THEN');
      expect(body).toContain('w := true');
      expect(body).toContain('ELSIF win_pct <= 0 THEN');
      expect(body).toContain('w := false');
      expect(body).toContain('ELSIF random() < (win_pct / 100.0) THEN');
      expect(body).toContain("'R_10','R_25','R_50','R_75','R_100'");
      expect(body).toContain("'EVEN','ODD','MATCHES','DIFFERS','OVER','UNDER'");
    }
    const practice = settlementBody('place_practice_trade');
    const real = settlementBody('place_real_trade');
    expect(practice).toContain("WHERE key = 'practice_win_rate'");
    expect(practice).not.toContain('real_win_rate');
    expect(real).toContain("WHERE key = 'real_win_rate'");
    expect(real).not.toContain('practice_win_rate');
    expect(practice.match(/pay := _stake \+ round\(_stake \* 0\.90, 2\)/g)).toHaveLength(1);
    expect(real.match(/pay := _stake \+ round\(_stake \* 0\.90, 2\)/g)).toHaveLength(1);
  });
});
