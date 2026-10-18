import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          if (url.searchParams.get('megapay') === '1') {
            const { describeMegaPayCredentials } = await import('@/lib/megapay');
            return Response.json(await describeMegaPayCredentials(), { headers: { 'Cache-Control': 'no-store' } });
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
