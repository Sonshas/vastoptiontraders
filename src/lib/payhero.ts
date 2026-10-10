import { createServerFn } from '@tanstack/react-start';

export function getPayHeroConfig() {
  return {
    apiUsername: process.env['PAYHERO_API_USERNAME'] ?? '',
    apiPassword: process.env['PAYHERO_API_PASSWORD'] ?? '',
    accountId: process.env['PAYHERO_ACCOUNT_ID'] ?? '',
    channelId: process.env['PAYHERO_CHANNEL_ID'] ?? '5376',
    basicAuthToken: process.env['PAYHERO_BASIC_AUTH_TOKEN'] ?? '',
    apiUrl: process.env['PAYHERO_API_URL'] ?? '',
    apiBaseUrl: process.env['PAYHERO_API_BASE_URL'] ?? 'https://api.payhero.co.ke',
    requestPath: process.env['PAYHERO_MOBILE_PAYMENT_PATH'] ?? '/api/mpesa/stkpush',
  };
}

export const payheroConfig = getPayHeroConfig();

export function normalizePhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('+254')) return digits.replace('+', '');
  return digits;
}

export function isPayHeroConfigured(): boolean {
  const config = getPayHeroConfig();
  return !!(
    config.apiUsername &&
    config.apiPassword &&
    config.accountId &&
    (config.channelId || config.channelId === '5376')
  );
}

export function resolvePayHeroEndpoint(): string {
  const config = getPayHeroConfig();
  if (config.apiUrl) {
    return config.apiUrl;
  }

  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const requestPath = config.requestPath.startsWith('/')
    ? config.requestPath
    : `/${config.requestPath}`;

  return `${baseUrl}${requestPath}`;
}

export function getPayHeroHeaders(extraHeaders: HeadersInit = {}): Headers {
  const config = getPayHeroConfig();
  const headers = new Headers(extraHeaders);

  if (config.basicAuthToken) {
    headers.set('Authorization', config.basicAuthToken);
  } else if (config.apiUsername && config.apiPassword) {
    const encoded = typeof Buffer !== 'undefined'
      ? Buffer.from(`${config.apiUsername}:${config.apiPassword}`).toString('base64')
      : btoa(`${config.apiUsername}:${config.apiPassword}`);
    headers.set('Authorization', `Basic ${encoded}`);
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

export function buildPayHeroMpesaRequest({
  amount,
  phoneNumber,
  reference,
  channelId,
}: {
  amount: number | string;
  phoneNumber: string;
  reference: string;
  channelId?: string;
}) {
  const config = getPayHeroConfig();
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  return {
    account_id: config.accountId,
    channel_id: channelId ?? config.channelId,
    amount: Number(amount),
    phone_number: normalizedPhone,
    reference,
    api_username: config.apiUsername,
    api_password: config.apiPassword,
  };
}

export const submitPayHeroMpesa = createServerFn({ method: 'POST' })
  .validator((value: { amount: number | string; phoneNumber: string; reference: string; channelId?: string; mode?: 'deposit' | 'withdraw' }) => value)
  .handler(async ({ data }) => {
    if (!isPayHeroConfigured()) {
      return {
        ok: false,
        status: 'not_configured',
        message: 'PayHero is not configured in server environment variables yet.',
      };
    }

    const endpoint = resolvePayHeroEndpoint();
    const payload = buildPayHeroMpesaRequest({
      amount: data.amount,
      phoneNumber: data.phoneNumber,
      reference: data.reference,
      channelId: data.channelId ?? getPayHeroConfig().channelId,
    });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: getPayHeroHeaders(),
        body: JSON.stringify(payload),
      });

      const bodyText = await response.text();
      let parsed: unknown = null;
      try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { parsed = null; }

      if (!response.ok) {
        const message = typeof parsed === 'object' && parsed && 'message' in parsed ? String((parsed as { message?: string }).message) : bodyText || 'PayHero request failed.';
        return {
          ok: false,
          status: response.status,
          message,
        };
      }

      const reference = typeof parsed === 'object' && parsed && 'reference' in parsed ? String((parsed as { reference?: string }).reference) : payload.reference;
      const transactionId = typeof parsed === 'object' && parsed && 'transaction_id' in parsed ? String((parsed as { transaction_id?: string }).transaction_id) : undefined;

      return {
        ok: true,
        status: response.status,
        payload,
        reference,
        transactionId,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'network_error',
        message: error instanceof Error ? error.message : 'Unknown PayHero network error.',
      };
    }
  });

