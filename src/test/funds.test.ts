import { describe, expect, it } from 'vitest';
import { calculateCompletedDeposits, calculateCompletedWithdrawals, calculateNetBalance } from '@/lib/funds';

describe('fund balance accounting', () => {
  it('only counts completed deposits and withdrawals toward the real balance', () => {
    const deposits = [
      { status: 'completed', amount: 100 },
      { status: 'pending', amount: 50 },
      { status: 'completed', amount: 25 },
    ];

    const withdrawals = [
      { status: 'completed', amount: 30 },
      { status: 'pending', amount: 10 },
    ];

    expect(calculateCompletedDeposits(deposits)).toBe(125);
    expect(calculateCompletedWithdrawals(withdrawals)).toBe(30);
    expect(calculateNetBalance(deposits, withdrawals)).toBe(95);
  });
});
