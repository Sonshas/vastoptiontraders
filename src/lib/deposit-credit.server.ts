import { depositNote, depositNoteMatchesTransaction, canCreditDeposit, megapayIdFromNote, megaPayPaymentState } from '@/lib/deposit-credit';
import { depositUsdFromKes, getMegaPayConfig } from '@/lib/megapay';

const STATUS_ENDPOINT = 'https://megapay.co.ke/backend/v1/transactionstatus';

type DepositRow = {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  note: string | null;
};

export type DepositCreditResult = {
  ok: boolean;
  status: 'completed' | 'pending' | 'failed' | 'not_found' | 'invalid' | 'unavailable';
  amountUsd?: number;
  message?: string;
};

async function admin() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}

async function providerStatus(transactionRequestId: string): Promise<unknown> {
  const config = getMegaPayConfig();
  if (!config.apiKey || !config.email) throw new Error('MegaPay is not configured.');
  const response = await fetch(STATUS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      email: config.email,
      transaction_request_id: transactionRequestId,
    }),
  });
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export async function recordPendingMegaPayDeposit(input: {
  userId: string;
  transactionRequestId: string;
  reference: string;
  amountKes: number;
  kesPerUsd: number;
}): Promise<{ depositId: string | null; creditedUsd: number; error?: string }> {
  const creditedUsd = depositUsdFromKes(input.amountKes, input.kesPerUsd);
  if (!(creditedUsd > 0)) return { depositId: null, creditedUsd: 0, error: 'The deposit amount could not be converted to USD.' };
  const { error, data } = await (await admin()).from('deposits').insert({
    user_id: input.userId,
    amount: creditedUsd,
    method: 'MegaPay M-Pesa',
    status: 'pending',
    note: depositNote(input),
  }).select('id').single();
  if (error || !data) return { depositId: null, creditedUsd, error: error?.message || 'The deposit could not be recorded.' };
  return { depositId: data.id, creditedUsd };
}

async function findDeposit(transactionRequestId: string, reference: string | undefined, userId: string | undefined): Promise<DepositRow | null> {
  const safeId = transactionRequestId.replace(/[^A-Za-z0-9]/g, '');
  const safeRef = reference?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  const db = await admin();
  const filters = [safeId ? `%${safeId}%` : '', safeRef ? `%ref=${safeRef}%` : ''].filter(Boolean);
  for (const pattern of filters) {
    let query = db.from('deposits').select('id, user_id, amount, status, note').ilike('note', pattern).limit(10);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const match = (data ?? []).find(row => (
      (safeId && depositNoteMatchesTransaction(row.note, safeId))
      || (safeRef && row.note?.includes(`ref=${safeRef}`))
    ));
    if (match) return match;
  }
  return null;
}

export async function creditMegaPayDeposit(input: {
  transactionRequestId?: string;
  reference?: string;
  userId?: string;
}): Promise<DepositCreditResult> {
  const requestedId = input.transactionRequestId?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  const reference = input.reference?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  if (!requestedId && !reference) return { ok: false, status: 'invalid', message: 'Missing MegaPay transaction id.' };

  let row: DepositRow | null;
  try {
    row = await findDeposit(requestedId, reference, input.userId);
  } catch (error) {
    return { ok: false, status: 'unavailable', message: error instanceof Error ? error.message : 'The deposit could not be loaded.' };
  }
  if (!row) return { ok: false, status: 'not_found', message: 'Deposit record was not found.' };
  const amountUsd = Number(row.amount);
  if (row.status === 'completed') return { ok: true, status: 'completed', amountUsd };
  if (row.status === 'rejected') return { ok: false, status: 'failed', amountUsd, message: 'The M-Pesa payment was not completed.' };

  const transactionRequestId = megapayIdFromNote(row.note) || requestedId;
  if (!transactionRequestId) return { ok: false, status: 'invalid', message: 'Missing MegaPay transaction id.' };

  let providerResult: unknown;
  try {
    providerResult = await providerStatus(transactionRequestId);
  } catch (error) {
    return { ok: false, status: 'unavailable', message: error instanceof Error ? error.message : 'MegaPay status could not be checked.' };
  }

  const state = megaPayPaymentState(providerResult);
  if (state === 'failed') {
    await (await admin()).from('deposits').update({ status: 'rejected' }).eq('id', row.id).eq('status', 'pending');
    return { ok: false, status: 'failed', amountUsd, message: 'The M-Pesa payment was not completed.' };
  }
  if (!canCreditDeposit(row.note, providerResult)) return { ok: true, status: 'pending', amountUsd };

  const { data: updated, error } = await (await admin()).from('deposits').update({ status: 'completed' }).eq('id', row.id).eq('status', 'pending').select('amount').maybeSingle();
  if (error) return { ok: false, status: 'unavailable', amountUsd, message: 'The payment was received but the balance could not be updated.' };
  return { ok: true, status: 'completed', amountUsd: Number(updated?.amount ?? row.amount) };
}
