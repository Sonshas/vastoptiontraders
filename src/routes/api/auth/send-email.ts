import { createFileRoute } from '@tanstack/react-router';
import { buildAuthEmail, sendResendEmail, verifySendEmailHook, type AuthEmailPayload } from '@/lib/resend-auth-email';

export const Route = createFileRoute('/api/auth/send-email')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env['RESEND_API_KEY'] ?? '';
        const hookSecret = process.env['SEND_EMAIL_HOOK_SECRET'] ?? '';
        const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
        if (!apiKey || !hookSecret || !supabaseUrl) {
          return Response.json({ error: 'Email sending is not configured.' }, { status: 503 });
        }

        const body = await request.text();
        const valid = verifySendEmailHook({
          secret: hookSecret,
          id: request.headers.get('webhook-id') ?? '',
          timestamp: request.headers.get('webhook-timestamp') ?? '',
          signature: request.headers.get('webhook-signature') ?? '',
          body,
        });
        if (!valid) {
          return Response.json({ error: { http_code: 401, message: 'Invalid email hook signature.' } }, { status: 401 });
        }

        try {
          const payload = JSON.parse(body) as AuthEmailPayload;
          const message = buildAuthEmail(payload, {
            from: process.env['RESEND_FROM'] || 'Option Market Traders <noreply@vastoptionmarkets.com>',
            replyTo: process.env['RESEND_REPLY_TO'] || 'sonshasopunga@gmail.com',
            supabaseUrl,
          });
          await sendResendEmail(message, apiKey);
          return Response.json({});
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not send email.';
          return Response.json({ error: { http_code: 500, message } }, { status: 500 });
        }
      },
    },
  },
});
