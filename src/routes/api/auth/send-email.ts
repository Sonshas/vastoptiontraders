import { createFileRoute } from '@tanstack/react-router';
import { buildAuthEmail, EmailSendTimeoutError, RESEND_SEND_TIMEOUT_MS, sendResendEmail, verifySendEmailHook, type AuthEmailPayload } from '@/lib/resend-auth-email';

const HOOK_RESPONSE_DEADLINE_MS = RESEND_SEND_TIMEOUT_MS + 500;

function hookError(httpCode: number, message: string): Response {
  return Response.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

async function handleSendEmail(request: Request): Promise<Response> {
  const apiKey = process.env['RESEND_API_KEY'] ?? '';
  const hookSecret = process.env['SEND_EMAIL_HOOK_SECRET'] ?? '';
  const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
  if (!apiKey || !hookSecret || !supabaseUrl) {
    return hookError(503, 'Email sending is not configured.');
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
    return hookError(401, 'Invalid email hook signature.');
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
    if (error instanceof EmailSendTimeoutError) return hookError(504, error.message);
    const message = error instanceof Error ? error.message : 'Could not send email.';
    return hookError(500, message);
  }
}

function withHookDeadline(work: Promise<Response>): Promise<Response> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(hookError(504, 'The email provider did not respond in time.')), HOOK_RESPONSE_DEADLINE_MS);
    work.then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      () => {
        clearTimeout(timer);
        resolve(hookError(500, 'Could not send email.'));
      },
    );
  });
}

export const Route = createFileRoute('/api/auth/send-email')({
  server: {
    handlers: {
      POST: ({ request }) => withHookDeadline(handleSendEmail(request)),
    },
  },
});
