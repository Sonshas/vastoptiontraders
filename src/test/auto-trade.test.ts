import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addSessionProfit, autoOrScannerTradeWins, autoTradeDecision, pickScannerMarket, sessionNoticeCopy } from '@/lib/auto-trade';

const root = dirname(fileURLToPath(import.meta.url));
const forceSql = readFileSync(join(root, '../../drizzle/migrations/0011_auto_trade_force_win.sql'), 'utf8');
const tradeSource = readFileSync(join(root, '../routes/_authenticated/trade.tsx'), 'utf8');

function settlementBody(name: 'place_practice_trade' | 'place_real_trade'): string {
  const start = forceSql.indexOf(`FUNCTION public.${name}`);
  const end = forceSql.indexOf(`REVOKE EXECUTE ON FUNCTION public.${name}`);
  return forceSql.slice(start, end);
}

describe('auto trade force win and session stops', () => {
  it('forces a win for auto and scanner trades even when the saved rate is 0', () => {
    expect(autoOrScannerTradeWins(true, 0, 0)).toBe(true);
    expect(autoOrScannerTradeWins(true, 0.99, 0)).toBe(true);
    expect(autoOrScannerTradeWins(true, 1, 0)).toBe(true);
    expect(autoOrScannerTradeWins(false, 0.5, 0)).toBe(false);
    expect(autoOrScannerTradeWins(false, 0, 0)).toBe(false);
    expect(autoOrScannerTradeWins(false, 0, 100)).toBe(true);
    expect(autoOrScannerTradeWins(false, 0.99, 100)).toBe(true);
    expect(autoOrScannerTradeWins(false, 0.89, 90)).toBe(true);
    expect(autoOrScannerTradeWins(false, 0.9, 90)).toBe(false);
  });

  it('stops when settled session profit reaches the target', () => {
    expect(autoTradeDecision({ sessionProfit: 41, targetProfit: 50, stopLoss: 25, balance: 1000, stake: 10 })).toBe('continue');
    expect(autoTradeDecision({ sessionProfit: 50, targetProfit: 50, stopLoss: 25, balance: 1000, stake: 10 })).toBe('target');
    expect(autoTradeDecision({ sessionProfit: addSessionProfit(45, 9), targetProfit: 50, stopLoss: 25, balance: 100, stake: 10 })).toBe('target');
    expect(sessionNoticeCopy('target', 54)).toEqual({
      title: 'Target profit hit',
      description: 'Target profit was hit. Session profit 54.00 USD.',
    });
  });

  it('stops when settled session loss reaches the stop loss', () => {
    expect(autoTradeDecision({ sessionProfit: -24.99, targetProfit: 50, stopLoss: 25, balance: 1000, stake: 10 })).toBe('continue');
    expect(autoTradeDecision({ sessionProfit: -25, targetProfit: 50, stopLoss: 25, balance: 1000, stake: 10 })).toBe('stop');
    expect(autoTradeDecision({ sessionProfit: addSessionProfit(-16, -10), targetProfit: 50, stopLoss: 25, balance: 100, stake: 10 })).toBe('stop');
    expect(sessionNoticeCopy('stop', -25)).toEqual({
      title: 'Stop loss hit',
      description: 'Stop loss was hit. Session profit -25.00 USD.',
    });
  });

  it('stops when the next stake is uncovered and still prefers a target or stop that was already hit', () => {
    expect(autoTradeDecision({ sessionProfit: 9, targetProfit: 50, stopLoss: 25, balance: 9.99, stake: 10 })).toBe('insufficient');
    expect(autoTradeDecision({ sessionProfit: 50, targetProfit: 50, stopLoss: 25, balance: 1, stake: 10 })).toBe('target');
    expect(autoTradeDecision({ sessionProfit: -25, targetProfit: 50, stopLoss: 25, balance: 1, stake: 10 })).toBe('stop');
  });

  it('picks a scanner market from the ticket list', () => {
    const markets = [{ id: 'R_10' }, { id: 'R_25' }, { id: 'R_100' }];
    expect(pickScannerMarket(markets, () => 0).id).toBe('R_10');
    expect(pickScannerMarket(markets, () => 0.99).id).toBe('R_100');
  });

  it('wins on the server when force win is set and keeps the admin rate for manual purchases', () => {
    for (const name of ['place_practice_trade', 'place_real_trade'] as const) {
      const body = settlementBody(name);
      expect(body).toContain('_force_win boolean DEFAULT false');
      expect(body).toContain('pay := _stake + round(_stake * 0.90, 2)');
      expect(body).toContain('IF COALESCE(_force_win, false) THEN');
      expect(body).toContain('w := true');
      expect(body.indexOf('IF COALESCE(_force_win, false) THEN')).toBeLessThan(body.indexOf('ELSIF win_pct >= 100 THEN'));
      expect(body).toContain('ELSIF win_pct <= 0 THEN');
      expect(body).toContain('w := false');
      expect(body).toContain('ELSIF random() < (win_pct / 100.0) THEN');
      expect(body).toContain('prof := CASE WHEN w THEN pay - _stake ELSE -_stake END');
    }
    const practice = settlementBody('place_practice_trade');
    const real = settlementBody('place_real_trade');
    expect(practice).toContain("WHERE key = 'practice_win_rate'");
    expect(practice).not.toContain('real_win_rate');
    expect(real).toContain("WHERE key = 'real_win_rate'");
    expect(real).not.toContain('practice_win_rate');
    expect(forceSql).toContain('DROP FUNCTION IF EXISTS public.place_practice_trade(text, text, int, numeric)');
    expect(forceSql).toContain('DROP FUNCTION IF EXISTS public.place_real_trade(text, text, int, numeric)');
  });

  it('keeps scanner and auto trade on the shared ticket and sends force win only for that flow', () => {
    expect(tradeSource).toContain('AI scanner');
    expect(tradeSource).toContain('Auto trade');
    expect(tradeSource).toContain('>Stop<');
    expect(tradeSource).toContain('aria-label="Target profit"');
    expect(tradeSource).toContain('aria-label="Stop loss"');
    expect(tradeSource).toContain('DEFAULT_TARGET_PROFIT');
    expect(tradeSource).toContain('DEFAULT_STOP_LOSS');
    expect(tradeSource).toContain('forceWin ? { _force_win: true }');
    expect(tradeSource).toContain('forceWin: scannerOn');
    expect(tradeSource).toContain('forceWin: true');
    expect(tradeSource).toContain("isReal ? 'place_real_trade' : 'place_practice_trade'");
    expect(tradeSource).toContain('sessionNoticeCopy');
    expect(tradeSource).toContain('className="trade-panel"');
  });
});
