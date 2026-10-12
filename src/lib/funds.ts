type FundingRecord = {
  status?: string | null;
  amount?: number | string | null;
};

export function calculateCompletedDeposits<T extends FundingRecord>(deposits: T[] = []): number {
  return deposits.reduce((sum, deposit) => {
    return deposit.status === 'completed' ? sum + Number(deposit.amount ?? 0) : sum;
  }, 0);
}

export function calculateCompletedWithdrawals<T extends FundingRecord>(withdrawals: T[] = []): number {
  return withdrawals.reduce((sum, withdrawal) => {
    return withdrawal.status === 'completed' ? sum + Number(withdrawal.amount ?? 0) : sum;
  }, 0);
}

export function calculateNetBalance<T extends FundingRecord>(deposits: T[] = [], withdrawals: T[] = []): number {
  return calculateCompletedDeposits(deposits) - calculateCompletedWithdrawals(withdrawals);
}

type ProfitRecord = {
  profit?: number | string | null;
};

export function calculateRealizedProfit<T extends ProfitRecord>(trades: T[] = []): number {
  return trades.reduce((sum, trade) => sum + Number(trade.profit ?? 0), 0);
}

/** Cash from completed funding, plus profit already settled on real trades. */
export function calculateAvailableRealBalance<T extends FundingRecord, P extends ProfitRecord>(
  deposits: T[] = [],
  withdrawals: T[] = [],
  trades: P[] = [],
): number {
  return calculateNetBalance(deposits, withdrawals) + calculateRealizedProfit(trades);
}
