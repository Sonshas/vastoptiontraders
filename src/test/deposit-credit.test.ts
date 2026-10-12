import { describe, expect, it } from 'vitest';
import { canCreditDeposit, depositNote, depositNoteMatchesTransaction, kesFromNote, megaPayPaymentState, megapayIdFromNote } from '@/lib/deposit-credit';

describe('MegaPay deposit crediting', () => {
  const note = depositNote({ transactionRequestId: 'SOFTPID1600', reference: '171000', amountKes: 1600, kesPerUsd: 129 });

  it('credits a completed payment for the requested shilling amount', () => {
    expect(megaPayPaymentState({ TransactionStatus: 'Completed', TransactionCode: '0', TransactionAmount: '1600' })).toBe('completed');
    expect(megaPayPaymentState({ ResponseCode: 0, ResponseDescription: 'Success. Request accepted for processing' })).toBe('completed');
    expect(canCreditDeposit(note, { TransactionStatus: 'Completed', TransactionAmount: 1600 })).toBe(true);
    expect(kesFromNote(note)).toBe(1600);
  });

  it('does not credit an accepted STK request or a smaller payment', () => {
    expect(megaPayPaymentState({ success: '200', massage: 'Request sent sucessfully.' })).toBe('pending');
    expect(megaPayPaymentState({ ResultCode: '200', ResultDesc: 'Success. Request accepted for processing' })).toBe('pending');
    expect(megaPayPaymentState({ ResponseCode: 1032, ResponseDescription: 'Request cancelled by user' })).toBe('failed');
    expect(canCreditDeposit(note, { TransactionStatus: 'Completed', TransactionAmount: 100 })).toBe(false);
    expect(canCreditDeposit(note, { success: '200' })).toBe(false);
  });

  it('finds the MegaPay id on new and older deposit notes', () => {
    expect(megapayIdFromNote(note)).toBe('SOFTPID1600');
    expect(depositNoteMatchesTransaction('MegaPay request: SOFTPID1600 | KES 1600', 'SOFTPID1600')).toBe(true);
    expect(depositNoteMatchesTransaction(note, 'OTHER')).toBe(false);
  });
});
