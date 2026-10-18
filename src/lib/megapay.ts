import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { megaPayDepositReference } from '@/lib/deposit-credit';

const STK_ENDPOINT = 'https://megapay.co.ke/backend/v1/initiatestk';
export const MEGAPAY_MIN_DEPOSIT_KES = 1600;

/** Vite inlines this dot-access at build time. Bracket access is not replaced. */
function bakedKesPerUsd(): string | undefined {
  try {
    const value = import.meta.env.VITE_MEGAPAY_KES_PER_USD;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function resolveMegaPayKesPerUsd(baked?: string, runtime?: string): number {
  return Number(baked?.trim() || runtime?.trim() || '');
}

export function readMegaPayKesPerUsd(runtimeValue?: string): number {
  const runtime = runtimeValue ?? (typeof process === 'undefined' ? undefined : process.env['VITE_MEGAPAY_KES_PER_USD']);
  return resolveMegaPayKesPerUsd(bakedKesPerUsd(), runtime);
}

export function minimumDepositMessage(): string {
  return 'Minimum deposit is KES 1,600.';
}

/** Whole shillings from a typed amount. 1600, 1,600 and 1.600 all count as 1600. */
export function parseDepositKes(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : Number.NaN;
  if (typeof value !== 'string') return Number.NaN;
  let cleaned = value.trim().replace(/kshs?|kes/ig, '').replace(/\s/g, '');
  if (!cleaned) return Number.NaN;
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(cleaned)) cleaned = cleaned.replace(',', '.');
  else cleaned = cleaned.replace(/,/g, '');
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount) : Number.NaN;
}

function providerMessage(result: unknown, fallback: string): string {
  if (!result || typeof result !== 'object') return fallback;
  const record = result as { message?: unknown; massage?: unknown };
  const text = record.message ?? record.massage;
  return typeof text === 'string' && text.trim() ? text : fallback;
}

export function depositMeetsMinimum(value: unknown): boolean {
  const amount = parseDepositKes(value);
  return Number.isFinite(amount) && amount >= MEGAPAY_MIN_DEPOSIT_KES;
}

/** USD credited to the account for a whole-shilling deposit at the fixed rate. */
export function depositUsdFromKes(amountKes: number, kesPerUsd: number): number {
  return Math.round((amountKes / kesPerUsd) * 100) / 100;
}

/** Docker keeps wrapping quotes, and a Windows env file leaves a trailing CR on the value. */
export function readMegaPayCredential(value: string | undefined): string {
  let text = (value ?? '').replace(/[\uFEFF\u200B\u200C\u200D]/g, '').replace(/\r/g, '').trim();
  text = text.replace(/^api[_ ]?key\s*[:=]\s*/i, '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function readMegaPayApiKey(value: string | undefined): string {
  return readMegaPayCredential(value).replace(/\s+/g, '');
}

export function getMegaPayConfig() {
  return {
    apiKey: readMegaPayApiKey(process.env['MEGAPAY_API_KEY']),
    email: readMegaPayCredential(process.env['MEGAPAY_EMAIL']),
    kesPerUsd: readMegaPayKesPerUsd(),
    endpoint: process.env['MEGAPAY_STK_URL'] ?? STK_ENDPOINT,
  };
}

function credentialShape(value: string) {
  return { length: value.length, hasAt: value.includes('@'), alnum: /^[A-Za-z0-9]+$/.test(value) };
}

async function megaPayStatusMessage(apiKey: string, email: string): Promise<string> {
  const response = await fetch('https://megapay.co.ke/backend/v1/transactionstatus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ api_key: apiKey, email, transaction_request_id: 'SOFTPID-not-a-real-id' }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return 'unparsed';
  const record = parsed as { errorMessage?: unknown; ResultDesc?: unknown; massage?: unknown; message?: unknown; ResultCode?: unknown };
  const message = record.errorMessage ?? record.ResultDesc ?? record.massage ?? record.message ?? record.ResultCode ?? 'no-message';
  return String(message).slice(0, 160);
}

/** Safe check: lengths and MegaPay's own message, never the key or email. */
export async function describeMegaPayCredentials(): Promise<{ key: ReturnType<typeof credentialShape>; email: ReturnType<typeof credentialShape>; normal: string; swapped: string }> {
  const config = getMegaPayConfig();
  const [normal, swapped] = await Promise.all([
    megaPayStatusMessage(config.apiKey, config.email),
    megaPayStatusMessage(config.email, config.apiKey),
  ]);
  return { key: credentialShape(config.apiKey), email: credentialShape(config.email), normal, swapped };
}

export function normalizeMegaPayPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D+/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return digits;
}

export function buildMegaPayStkRequest({
  amountKes,
  kesPerUsd,
  phoneNumber,
  reference,
  apiKey,
  email,
}: {
  amountKes: unknown;
  kesPerUsd: number;
  phoneNumber: string;
  reference: string;
  apiKey: string;
  email: string;
}) {
  if (!Number.isFinite(kesPerUsd) || kesPerUsd <= 0) {
    throw new Error('Set a valid VITE_MEGAPAY_KES_PER_USD exchange rate.');
  }
  const wholeKes = parseDepositKes(amountKes);
  if (!depositMeetsMinimum(wholeKes)) {
    throw new Error(minimumDepositMessage());
  }

  const msisdn = normalizeMegaPayPhoneNumber(phoneNumber);
  if (!/^254[17]\d{8}$/.test(msisdn)) {
    throw new Error('Use a valid Kenyan M-Pesa phone number.');
  }

  return {
    api_key: apiKey,
    email,
    amount: wholeKes,
    msisdn,
    reference,
  };
}

export const submitMegaPayStk = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .validator((value: { amountKes: number | string; phoneNumber: string; reference: string }) => value)
  .handler(async ({ data, context }) => {
    const config = getMegaPayConfig();
    if (!config.apiKey || !config.email) {
      return { ok: false, status: 'not_configured', message: 'Set MEGAPAY_API_KEY and MEGAPAY_EMAIL in the server environment.' };
    }
    if (!Number.isFinite(config.kesPerUsd) || config.kesPerUsd <= 0) {
      return { ok: false, status: 'missing_exchange_rate', message: 'Set a valid VITE_MEGAPAY_KES_PER_USD fixed exchange rate.' };
    }

    const reference = megaPayDepositReference(data.reference);
    let payload: ReturnType<typeof buildMegaPayStkRequest>;
    try {
      payload = buildMegaPayStkRequest({ ...data, reference, ...config });
    } catch (error) {
      return { ok: false, status: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid deposit request.' };
    }

    const { recordPendingMegaPayDeposit, attachMegaPayTransaction, rejectUnsentMegaPayDeposit } = await import('@/lib/deposit-credit.server');
    const recorded = await recordPendingMegaPayDeposit({
      userId: String(context.userId ?? ''),
      reference,
      amountKes: payload.amount,
      kesPerUsd: config.kesPerUsd,
    });
    if (!recorded.depositId) {
      return { ok: false, status: 'not_recorded', message: recorded.error || 'The deposit could not be recorded.' };
    }

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...payload, amount: String(payload.amount) }),
      });
      const bodyText = await response.text();
      let result: unknown = null;
      try { result = bodyText ? JSON.parse(bodyText) : null; } catch { result = null; }

      const { megaPayTransactionRequestId } = await import('@/lib/deposit-credit');
      const transactionRequestId = megaPayTransactionRequestId(result);
      const success = typeof result === 'object' && result && 'success' in result
        ? String((result as { success?: string | number }).success)
        : '';
      if (!response.ok || (success !== '200' && !transactionRequestId)) {
        await rejectUnsentMegaPayDeposit(recorded.depositId);
        return {
          ok: false,
          status: response.ok ? 'provider_error' : response.status,
          message: providerMessage(result, bodyText || 'MegaPay did not confirm that the STK request was accepted.'),
        };
      }
      if (!transactionRequestId) {
        return {
          ok: true,
          status: 'accepted',
          reference,
          transactionRequestId: '',
          depositId: recorded.depositId,
          amountKes: payload.amount,
          kesPerUsd: config.kesPerUsd,
          creditedUsd: recorded.creditedUsd,
        };
      }

      try {
        await attachMegaPayTransaction(recorded.depositId, {
          transactionRequestId,
          reference,
          amountKes: payload.amount,
          kesPerUsd: config.kesPerUsd,
        });
      } catch {
        /* The pending row still matches the MegaPay reference if the id note could not be saved. */
      }

      return {
        ok: true,
        status: response.status,
        reference,
        transactionRequestId,
        depositId: recorded.depositId,
        amountKes: payload.amount,
        kesPerUsd: config.kesPerUsd,
        creditedUsd: recorded.creditedUsd,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'network_error',
        message: error instanceof Error ? error.message : 'Unknown MegaPay network error.',
      };
    }
  });

export const syncMegaPayDeposit = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .validator((value: { transactionRequestId: string }) => value)
  .handler(async ({ data, context }) => {
    const { creditMegaPayDeposit } = await import('@/lib/deposit-credit.server');
    return creditMegaPayDeposit({
      transactionRequestId: data.transactionRequestId,
      userId: String(context.userId ?? ''),
    });
  });
