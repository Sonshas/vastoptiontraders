import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (new URL(request.url).searchParams.get('megapay') === '1') {
            const { getMegaPayConfig } = await import('@/lib/megapay');
            const { storedMegaPayApiKey } = await import('@/lib/deposit-credit.server');
            const config = getMegaPayConfig();
            const apiKey = (await storedMegaPayApiKey()) || config.apiKey;
            const response = await fetch('https://megapay.co.ke/backend/v1/transactionstatus', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ api_key: apiKey, email: config.email, transaction_request_id: 'SOFTPID-not-a-real-id' }),
            });
            const text = await response.text();
            let message = 'unparsed';
            try {
              const parsed = JSON.parse(text) as { errorMessage?: unknown; ResultDesc?: unknown };
              message = String(parsed.errorMessage || parsed.ResultDesc || 'no-message').slice(0, 160);
            } catch { /* keep unparsed */ }
            return Response.json({ message, keyLength: apiKey.length }, { headers: { 'Cache-Control': 'no-store' } });
          }
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
          void import('@/lib/deposit-credit.server')
            .then(module => module.syncPendingMegaPayDeposits())
            .catch(() => undefined);
          const { error } = await supabaseAdmin.from('site_settings').select('key').limit(1);
          if (error) throw error;
          return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
        } catch {
          return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
        }
      },
    },
  },
});
