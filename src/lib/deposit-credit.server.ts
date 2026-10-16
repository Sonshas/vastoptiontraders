import { depositNote, depositNoteMatchesTransaction, megapayIdFromNote, referenceFromNote, resolveCreditDecision } from '@/lib/deposit-credit';
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

function paymentToken(value: string | undefined): string {
  return value?.replace(/[^A-Za-z0-9]/g, '') ?? '';
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
  transactionRequestId?: string;
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

export async function attachMegaPayTransaction(depositId: string, input: {
  transactionRequestId: string;
  reference: string;
  amountKes: number;
  kesPerUsd: number;
}): Promise<void> {
  const { error } = await (await admin()).from('deposits').update({ note: depositNote(input) }).eq('id', depositId);
  if (error) throw new Error(error.message);
}

export async function rejectUnsentMegaPayDeposit(depositId: string): Promise<void> {
  await (await admin()).from('deposits').update({ status: 'rejected' }).eq('id', depositId).eq('status', 'pending');
}

async function findDeposit(transactionRequestId: string, reference: string | undefined, userId: string | undefined): Promise<DepositRow | null> {
  const safeId = paymentToken(transactionRequestId);
  const safeRef = paymentToken(reference);
  const db = await admin();
  const filters = [safeId ? `%${safeId}%` : '', safeRef ? `%ref=${safeRef}%` : ''].filter(Boolean);
  for (const pattern of filters) {
    let query = db.from('deposits').select('id, user_id, amount, status, note').ilike('note', pattern).limit(10);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const match = (data ?? []).find(row => {
      const idMatch = Boolean(safeId && depositNoteMatchesTransaction(row.note, safeId));
      const refMatch = Boolean(safeRef && (row.note?.includes(`ref=${safeRef}`) || referenceFromNote(row.note) === safeRef));
      if (pattern.includes('ref=')) return refMatch;
      return idMatch || refMatch;
    });
    if (match) return match;
  }
  return null;
}

export async function creditMegaPayDeposit(input: {
  transactionRequestId?: string;
  reference?: string;
  userId?: string;
  providerResult?: unknown;
}): Promise<DepositCreditResult> {
  const requestedId = paymentToken(input.transactionRequestId);
  const reference = paymentToken(input.reference);
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

  const storedId = paymentToken(megapayIdFromNote(row.note) ?? '');
  const storedRef = paymentToken(referenceFromNote(row.note) ?? '');
  const transactionRequestId = storedId || requestedId;
  const referenceMatches = Boolean(reference && storedRef && reference === storedRef);
  const callbackMatches = referenceMatches || !requestedId || !storedId || storedId === requestedId;
  const provided = callbackMatches ? input.providerResult : undefined;

  let fetched: unknown = null;
  if (transactionRequestId) {
    try {
      fetched = await providerStatus(transactionRequestId);
    } catch (error) {
      if (!provided) {
        return { ok: false, status: 'unavailable', message: error instanceof Error ? error.message : 'MegaPay status could not be checked.' };
      }
    }
  } else if (!provided) {
    return { ok: true, status: 'pending', amountUsd };
  }

  const decision = resolveCreditDecision(row.note, provided, fetched);
  if (decision === 'failed') {
    if (row.status === 'pending') {
      await (await admin()).from('deposits').update({ status: 'rejected' }).eq('id', row.id).eq('status', 'pending');
    }
    return { ok: false, status: 'failed', amountUsd, message: 'The M-Pesa payment was not completed.' };
  }
  if (decision !== 'completed') {
    if (row.status === 'rejected') return { ok: false, status: 'failed', amountUsd, message: 'The M-Pesa payment was not completed.' };
    return { ok: true, status: 'pending', amountUsd };
  }

  const { data: updated, error } = await (await admin()).from('deposits').update({ status: 'completed' }).eq('id', row.id).in('status', ['pending', 'rejected']).select('amount').maybeSingle();
  if (error) return { ok: false, status: 'unavailable', amountUsd, message: 'The payment was received but the balance could not be updated.' };
  if (updated) return { ok: true, status: 'completed', amountUsd: Number(updated.amount) };

  const { data: current } = await (await admin()).from('deposits').select('status, amount').eq('id', row.id).maybeSingle();
  if (current?.status === 'completed') return { ok: true, status: 'completed', amountUsd: Number(current.amount) };
  return { ok: true, status: 'pending', amountUsd };
}

let pendingSync: Promise<void> | undefined;

export function syncPendingMegaPayDeposits(): Promise<void> {
  if (pendingSync) return pendingSync;
  pendingSync = syncPendingMegaPayDepositsOnce().finally(() => { pendingSync = undefined; });
  return pendingSync;
}

async function syncPendingMegaPayDepositsOnce(): Promise<void> {
  const { data, error } = await (await admin()).from('deposits')
    .select('id, note')
    .eq('status', 'pending')
    .eq('method', 'MegaPay M-Pesa')
    .order('created_at', { ascending: true })
    .limit(25);
  if (error || !data?.length) return;
  for (const row of data) {
    const transactionRequestId = megapayIdFromNote(row.note) ?? '';
    const reference = referenceFromNote(row.note) ?? '';
    if (!transactionRequestId && !reference) continue;
    try {
      await creditMegaPayDeposit({ transactionRequestId, reference });
    } catch {
      /* Leave the row pending until MegaPay confirms it. */
    }
  }
}
