export type WithdrawalTaxState = {
  visible: boolean;
  amount: number;
  label: string;
};

export function getWithdrawalTaxState({
  hasCompletedDeposit,
  taxAmount,
}: {
  hasCompletedDeposit: boolean;
  taxAmount: number;
}): WithdrawalTaxState {
  const normalizedAmount = Number.isFinite(taxAmount) ? Math.max(0, Number(taxAmount)) : 0;

  if (!hasCompletedDeposit || normalizedAmount <= 0) {
    return { visible: false, amount: 0, label: '' };
  }

  return {
    visible: true,
    amount: normalizedAmount,
    label: 'Tax compliance fee',
  };
}
