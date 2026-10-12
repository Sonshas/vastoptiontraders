import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

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

/** Smallest USD amount, to the cent, whose rounded KES is at least the MegaPay minimum. */
export function minimumDepositUsd(kesPerUsd: number): number {
  const usd = (MEGAPAY_MIN_DEPOSIT_KES - 0.5) / kesPerUsd;
  return Math.ceil(usd * 100 - 1e-9) / 100;
}

export function minimumDepositMessage(kesPerUsd: number): string {
  const usd = minimumDepositUsd(kesPerUsd);
  const usdText = Number.isFinite(usd) ? ` (${usd.toFixed(2)} USD)` : '';
  return `Minimum deposit is KES 1,600${usdText}.`;
}

export function getMegaPayConfig() {
  return {
    apiKey: process.env['MEGAPAY_API_KEY'] ?? '',
    email: process.env['MEGAPAY_EMAIL'] ?? '',
    kesPerUsd: readMegaPayKesPerUsd(),
    endpoint: process.env['MEGAPAY_STK_URL'] ?? STK_ENDPOINT,
  };
}

export function normalizeMegaPayPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D+/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return digits;
}

export function buildMegaPayStkRequest({
  amountUsd,
  kesPerUsd,
  phoneNumber,
  reference,
  apiKey,
  email,
}: {
  amountUsd: number;
  kesPerUsd: number;
  phoneNumber: string;
  reference: string;
  apiKey: string;
  email: string;
}) {
  if (!Number.isFinite(kesPerUsd) || kesPerUsd <= 0) {
    throw new Error('Set a valid VITE_MEGAPAY_KES_PER_USD exchange rate.');
  }
  const amountKes = Math.round(amountUsd * kesPerUsd);
  if (!Number.isFinite(amountUsd) || amountKes < MEGAPAY_MIN_DEPOSIT_KES) {
    throw new Error(minimumDepositMessage(kesPerUsd));
  }

  const msisdn = normalizeMegaPayPhoneNumber(phoneNumber);
  if (!/^254[17]\d{8}$/.test(msisdn)) {
    throw new Error('Use a valid Kenyan M-Pesa phone number.');
  }

  return {
    api_key: apiKey,
    email,
    amount: amountKes,
    msisdn,
    reference,
  };
}

export const submitMegaPayStk = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .validator((value: { amountUsd: number; phoneNumber: string; reference: string }) => value)
  .handler(async ({ data }) => {
    const config = getMegaPayConfig();
    if (!config.apiKey || !config.email) {
      return { ok: false, status: 'not_configured', message: 'Set MEGAPAY_API_KEY and MEGAPAY_EMAIL in the server environment.' };
    }
    if (!Number.isFinite(config.kesPerUsd) || config.kesPerUsd <= 0) {
      return { ok: false, status: 'missing_exchange_rate', message: 'Set a valid VITE_MEGAPAY_KES_PER_USD fixed exchange rate.' };
    }

    let payload: ReturnType<typeof buildMegaPayStkRequest>;
    try {
      payload = buildMegaPayStkRequest({ ...data, ...config });
    } catch (error) {
      return { ok: false, status: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid deposit request.' };
    }

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const bodyText = await response.text();
      let result: unknown = null;
      try { result = bodyText ? JSON.parse(bodyText) : null; } catch { result = null; }

      if (!response.ok) {
        const message = typeof result === 'object' && result && 'message' in result
          ? String((result as { message?: string }).message)
          : bodyText || 'MegaPay STK request failed.';
        return { ok: false, status: response.status, message };
      }

      const transactionRequestId = typeof result === 'object' && result && 'transaction_request_id' in result
        ? String((result as { transaction_request_id?: string }).transaction_request_id ?? '')
        : '';
      const success = typeof result === 'object' && result && 'success' in result
        ? String((result as { success?: string | number }).success)
        : '';
      if (success !== '200' || !transactionRequestId) {
        const message = typeof result === 'object' && result && 'message' in result
          ? String((result as { message?: string }).message)
          : 'MegaPay did not confirm that the STK request was accepted.';
        return { ok: false, status: 'provider_error', message };
      }

      return {
        ok: true,
        status: response.status,
        reference: data.reference,
        transactionRequestId,
        amountKes: payload.amount,
        kesPerUsd: config.kesPerUsd,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'network_error',
        message: error instanceof Error ? error.message : 'Unknown MegaPay network error.',
      };
    }
  });
