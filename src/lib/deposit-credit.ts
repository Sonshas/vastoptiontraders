export type MegaPayPaymentState = 'completed' | 'failed' | 'pending';

const NESTED_KEYS = ['data', 'transaction', 'result', 'payload', 'body', 'response'];
const FAILURE_CODES = ['1', '1032', '1037', '1025', '9999', '2001', '1019', '1001'];

function readField(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in record) return record[name];
    const found = Object.keys(record).find(key => key.toLowerCase() === name.toLowerCase());
    if (found) return record[found];
  }
  return undefined;
}

export function asMegaPayRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asMegaPayRecord(value[0]);
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

/** Surface TransactionStatus / ResponseCode when MegaPay nests the transaction. */
export function normalizeMegaPayResult(result: unknown): Record<string, unknown> {
  const record = asMegaPayRecord(result);
  const merged: Record<string, unknown> = { ...record };
  for (const key of NESTED_KEYS) {
    const nested = readField(record, [key]);
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    for (const [field, value] of Object.entries(nested as Record<string, unknown>)) {
      const current = readField(merged, [field]);
      if (current == null || current === '') merged[field] = value;
    }
  }
  return merged;
}

function paidStatus(status: string): boolean {
  return status === 'completed' || status === 'success' || status === 'successful' || status === 'paid';
}

/** Paid only after MegaPay reports a completed transaction, not merely an accepted STK request. */
export function megaPayPaymentState(result: unknown): MegaPayPaymentState {
  const record = normalizeMegaPayResult(result);
  if (!Object.keys(record).length) return 'pending';
  const status = String(readField(record, ['TransactionStatus', 'transaction_status', 'payment_status', 'status']) ?? '').trim().toLowerCase();
  const code = readField(record, ['TransactionCode', 'ResponseCode']);
  const codeText = code == null || code === '' ? '' : String(code).trim();
  if (status.includes('cancel') || status.includes('fail') || status.includes('timeout') || status.includes('insufficient')) return 'failed';
  if (FAILURE_CODES.includes(codeText)) return 'failed';
  if (paidStatus(status)) return 'completed';
  if (!status && codeText === '0') return 'completed';
  return 'pending';
}

export function megaPayPaidKes(result: unknown): number {
  const record = normalizeMegaPayResult(result);
  const amount = readField(record, ['TransactionAmount', 'amount']);
  const paid = Number(amount);
  return Number.isFinite(paid) ? Math.round(paid) : Number.NaN;
}

function nestedRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  return NESTED_KEYS.flatMap(key => {
    const nested = readField(record, [key]);
    return nested && typeof nested === 'object' && !Array.isArray(nested) ? [nested as Record<string, unknown>] : [];
  });
}

/** MegaPay sometimes nests the STK id under data or transaction. */
export function megaPayTransactionRequestId(result: unknown): string {
  const record = asMegaPayRecord(result);
  const direct = readField(record, ['transaction_request_id', 'TransactionID', 'transactionId']);
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct);
  for (const nested of nestedRecords(record)) {
    const found = megaPayTransactionRequestId(nested);
    if (found) return found;
  }
  return '';
}

export function megaPayCallbackFields(body: unknown): { transactionRequestId: string; reference: string } {
  const record = normalizeMegaPayResult(body);
  return {
    transactionRequestId: megaPayTransactionRequestId(record),
    reference: String(readField(record, ['TransactionReference', 'reference']) ?? '').trim(),
  };
}

/** A confirmed callback can finish a deposit while a status query is still only "request accepted". */
export function resolveCreditDecision(note: string | null | undefined, provided: unknown, fetched: unknown): MegaPayPaymentState {
  if (megaPayPaymentState(fetched) === 'failed' || megaPayPaymentState(provided) === 'failed') return 'failed';
  if (canCreditDeposit(note, fetched) || canCreditDeposit(note, provided)) return 'completed';
  return 'pending';
}

export function depositNote(input: { transactionRequestId?: string; reference: string; amountKes: number; kesPerUsd: number }): string {
  return [
    input.transactionRequestId ? `megapay_id=${input.transactionRequestId}` : '',
    `ref=${input.reference}`,
    `kes=${input.amountKes}`,
    `rate=${input.kesPerUsd}`,
  ].filter(Boolean).join(' | ');
}

export function megaPayDepositReference(clientReference: string): string {
  const prefix = clientReference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  const token = globalThis.crypto.randomUUID().replace(/-/g, '');
  return `${prefix}${token}`;
}

export function megapayIdFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  return note.match(/megapay_id=([^|\s]+)/)?.[1]
    ?? note.match(/MegaPay request: ([^|\s]+)/)?.[1]
    ?? null;
}

export function referenceFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  return note.match(/ref=([^|\s]+)/)?.[1] ?? null;
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
  if (!Number.isFinite(expectedKes) || !Number.isFinite(paidKes)) return true;
  return paidKes > 0 && paidKes >= expectedKes;
}
