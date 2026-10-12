import { settlementRollWins } from '@/lib/practice-win-rate';

export const DEFAULT_TARGET_PROFIT = 50;
export const DEFAULT_STOP_LOSS = 25;

export type AutoTradeStop = 'continue' | 'target' | 'stop' | 'insufficient';

export type AutoTradeSnapshot = {
  sessionProfit: number;
  targetProfit: number;
  stopLoss: number;
  balance: number;
  stake: number;
};

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/** Session profit from settled trade results, in cents so 9 + 9 stays 18. */
export function addSessionProfit(sessionProfit: number, tradeProfit: number): number {
  return (cents(sessionProfit) + cents(tradeProfit)) / 100;
}

/**
 * Stop after a settled trade when the session reached its target or its loss
 * limit. A balance that cannot cover the next stake stops the loop without
 * counting as a stop-loss hit. Target and stop loss win over that balance check.
 */
export function autoTradeDecision(snapshot: AutoTradeSnapshot): AutoTradeStop {
  if (cents(snapshot.sessionProfit) >= cents(snapshot.targetProfit)) return 'target';
  if (cents(snapshot.sessionProfit) <= -cents(snapshot.stopLoss)) return 'stop';
  if (cents(snapshot.balance) < cents(snapshot.stake)) return 'insufficient';
  return 'continue';
}

/** Auto trade and AI scanner trades win even when the saved rate is not 100. Manual trades keep the rate. */
export function autoOrScannerTradeWins(forceWin: boolean, roll: number, winRatePercent: unknown): boolean {
  if (forceWin) return true;
  return settlementRollWins(roll, winRatePercent);
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function sessionNoticeCopy(kind: 'target' | 'stop', sessionProfit: number): { title: string; description: string } {
  const amount = formatUsd(sessionProfit);
  if (kind === 'stop') {
    return {
      title: 'Stop loss hit',
      description: `Stop loss was hit. Session profit ${amount} USD.`,
    };
  }
  return {
    title: 'Target profit hit',
    description: `Target profit was hit. Session profit ${amount} USD.`,
  };
}

/** Pick one of the markets the ticket already offers. */
export function pickScannerMarket<T>(markets: readonly T[], random: () => number = Math.random): T {
  const index = Math.min(markets.length - 1, Math.floor(random() * markets.length));
  return markets[index]!;
}

/** First contract side the ticket can buy at this prediction. */
export function tradableSide(sides: readonly string[], barrier: number): string | null {
  for (const side of sides) {
    if (side === 'OVER' && barrier > 8) continue;
    if (side === 'UNDER' && barrier < 1) continue;
    return side;
  }
  return null;
}
