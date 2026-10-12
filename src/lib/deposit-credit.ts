export type MegaPayPaymentState = 'completed' | 'failed' | 'pending';

function readField(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in record) return record[name];
    const found = Object.keys(record).find(key => key.toLowerCase() === name.toLowerCase());
    if (found) return record[found];
  }
  return undefined;
}

/** Paid only after MegaPay reports a completed transaction, not merely an accepted STK request. */
export function megaPayPaymentState(result: unknown): MegaPayPaymentState {
  if (!result || typeof result !== 'object') return 'pending';
  const record = result as Record<string, unknown>;
  const status = String(readField(record, ['TransactionStatus', 'transaction_status']) ?? '').trim().toLowerCase();
  const code = readField(record, ['TransactionCode', 'ResponseCode']);
  const codeText = code == null || code === '' ? '' : String(code);
  if (status.includes('cancel') || status.includes('fail') || status.includes('timeout') || status.includes('insufficient')) return 'failed';
  if (['1', '1032', '1037', '1025', '9999', '2001', '1019', '1001'].includes(codeText)) return 'failed';
  if (status === 'completed' || status === 'success') return 'completed';
  if (!status && codeText === '0') return 'completed';
  return 'pending';
}

export function megaPayPaidKes(result: unknown): number {
  if (!result || typeof result !== 'object') return Number.NaN;
  const amount = readField(result as Record<string, unknown>, ['TransactionAmount', 'amount']);
  const paid = Number(amount);
  return Number.isFinite(paid) ? Math.round(paid) : Number.NaN;
}

export function depositNote(input: { transactionRequestId: string; reference: string; amountKes: number; kesPerUsd: number }): string {
  return [
    `megapay_id=${input.transactionRequestId}`,
    `ref=${input.reference}`,
    `kes=${input.amountKes}`,
    `rate=${input.kesPerUsd}`,
  ].join(' | ');
}

export function megapayIdFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  return note.match(/megapay_id=([A-Za-z0-9]+)/)?.[1]
    ?? note.match(/MegaPay request: ([A-Za-z0-9]+)/)?.[1]
    ?? null;
}

export function kesFromNote(note: string | null | undefined): number {
  const match = note?.match(/kes=(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

export function depositNoteMatchesTransaction(note: string | null | undefined, transactionRequestId: string): boolean {
  const id = transactionRequestId.trim();
  if (!note || !id) return false;
  return note.includes(`megapay_id=${id}`) || note.includes(`MegaPay request: ${id}`);
}

/** A confirmed payment can credit the stored USD amount when MegaPay's shilling amount matches. */
export function canCreditDeposit(note: string | null | undefined, providerResult: unknown): boolean {
  if (megaPayPaymentState(providerResult) !== 'completed') return false;
  const expectedKes = kesFromNote(note);
  const paidKes = megaPayPaidKes(providerResult);
  if (!Number.isFinite(expectedKes) || !Number.isFinite(paidKes) || paidKes <= 0) return true;
  return paidKes >= expectedKes;
}
