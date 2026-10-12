/** Flat winning profit on every market and contract. A 10 stake wins 9 and returns 19. */
export const WINNING_PROFIT_RATE = 0.9;

export const PAYOUT_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'] as const;
export const PAYOUT_CONTRACTS = ['EVEN', 'ODD', 'MATCHES', 'DIFFERS', 'OVER', 'UNDER'] as const;

function stakeCents(stake: number): number {
  return Math.round(stake * 100);
}

/** Profit credited on a win, rounded to cents the same way as numeric round(stake * 0.90, 2). */
export function winningProfit(stake: number): number {
  return Math.round((stakeCents(stake) * 90) / 100) / 100;
}

/** Gross return quoted on the ticket and stored as payout: stake plus 90% profit. */
export function quotedPayout(stake: number): number {
  const cents = stakeCents(stake);
  return (cents + Math.round((cents * 90) / 100)) / 100;
}

/** Same 90% profit for every volatility and every contract the ticket can buy. */
export function settledWin(market: string, contract: string, stake: number): { payout: number; profit: number } {
  if (!PAYOUT_MARKETS.includes(market as (typeof PAYOUT_MARKETS)[number])) {
    throw new Error('Unknown market');
  }
  if (!PAYOUT_CONTRACTS.includes(contract as (typeof PAYOUT_CONTRACTS)[number])) {
    throw new Error('Unknown contract');
  }
  const profit = winningProfit(stake);
  return { payout: quotedPayout(stake), profit };
}
