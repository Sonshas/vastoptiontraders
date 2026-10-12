import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/megapay/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json() as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const transactionRequestId = String(body.transaction_request_id ?? body.TransactionID ?? '');
        const reference = String(body.TransactionReference ?? body.reference ?? '');
        const { creditMegaPayDeposit } = await import('@/lib/deposit-credit.server');
        const result = await creditMegaPayDeposit({ transactionRequestId, reference });
        return Response.json({ ok: result.ok, status: result.status });
      },
    },
  },
});
