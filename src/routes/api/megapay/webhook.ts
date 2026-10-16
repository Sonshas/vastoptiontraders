import { asMegaPayRecord, megaPayCallbackFields } from '@/lib/deposit-credit';
import { createFileRoute } from '@tanstack/react-router';

async function readCallback(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const record: Record<string, unknown> = {};
    form.forEach((value, key) => {
      if (typeof value === 'string') record[key] = value;
    });
    return record;
  }
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return asMegaPayRecord(JSON.parse(text) as unknown);
  } catch {
    const params = new URLSearchParams(text);
    const record = Object.fromEntries(params.entries());
    if (!Object.keys(record).length) throw new Error('invalid');
    return record;
  }
}

export const Route = createFileRoute('/api/megapay/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = await readCallback(request);
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const { transactionRequestId, reference } = megaPayCallbackFields(body);
        const { creditMegaPayDeposit } = await import('@/lib/deposit-credit.server');
        let result = await creditMegaPayDeposit({ transactionRequestId, reference, providerResult: body });
        if (result.status === 'not_found') {
          await new Promise(resolve => setTimeout(resolve, 700));
          result = await creditMegaPayDeposit({ transactionRequestId, reference, providerResult: body });
        }
        return Response.json({ ok: result.ok, status: result.status });
      },
    },
  },
});
