import { describe, expect, it } from 'vitest';
import { getWithdrawalTaxState } from '@/lib/withdrawal-tax';

describe('withdrawal tax compliance', () => {
  it('requires a tax notice only after a completed deposit and withdrawal attempt', () => {
    expect(getWithdrawalTaxState({ hasCompletedDeposit: false, taxAmount: 25 })).toEqual({
      visible: false,
      amount: 0,
      label: '',
    });

    expect(getWithdrawalTaxState({ hasCompletedDeposit: true, taxAmount: 25 })).toEqual({
      visible: true,
      amount: 25,
      label: 'Tax compliance fee',
    });
  });
});
