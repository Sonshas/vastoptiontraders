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
