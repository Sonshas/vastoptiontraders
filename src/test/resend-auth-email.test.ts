import { describe, expect, it } from 'vitest';
import { buildAuthEmail, EmailSendTimeoutError, sendResendEmail, signSendEmailHook, verifySendEmailHook } from '@/lib/resend-auth-email';

const secret = `v1,whsec_${Buffer.from('test-hook-secret').toString('base64')}`;

describe('Resend auth email', () => {
  it('builds a registration email that replies to the configured address', () => {
    const message = buildAuthEmail(
      {
        user: { email: 'trader@example.com' },
        email_data: { token_hash: 'hash-1', email_action_type: 'signup', redirect_to: 'https://vastoptionmarkets.com' },
      },
      { from: 'Option Market Traders <noreply@vastoptionmarkets.com>', replyTo: 'sonshasopunga@gmail.com', supabaseUrl: 'https://kgygsfqxiwlachohktql.supabase.co/' },
    );

    expect(message.subject).toBe('Confirm your Option Market Traders account');
    expect(message.replyTo).toBe('sonshasopunga@gmail.com');
    expect(message.text).toContain('https://kgygsfqxiwlachohktql.supabase.co/auth/v1/verify?token=hash-1&type=signup&redirect_to=https%3A%2F%2Fvastoptionmarkets.com');
  });

  it('builds an email-change confirmation', () => {
    const message = buildAuthEmail(
      {
        user: { email: 'new@example.com' },
        email_data: { token_hash: 'old-hash', token_hash_new: 'new-hash', email_action_type: 'email_change', redirect_to: 'https://vastoptionmarkets.com' },
      },
      { from: 'Option Market Traders <noreply@vastoptionmarkets.com>', replyTo: 'sonshasopunga@gmail.com', supabaseUrl: 'https://kgygsfqxiwlachohktql.supabase.co' },
    );

    expect(message.subject).toBe('Confirm your new Option Market Traders email');
    expect(message.to).toBe('new@example.com');
    expect(message.text).toContain('token=new-hash');
    expect(message.text).toContain('type=email_change');
  });

  it('builds a password reset email', () => {
    const message = buildAuthEmail(
      { user: { email: 'trader@example.com' }, email_data: { token_hash: 'hash-2', email_action_type: 'recovery' } },
      { from: 'Option Market Traders <noreply@vastoptionmarkets.com>', supabaseUrl: 'https://kgygsfqxiwlachohktql.supabase.co' },
    );

    expect(message.subject).toBe('Reset your Option Market Traders password');
    expect(message.text).toContain('type=recovery');
  });

  it('accepts a signed Supabase send-email hook and rejects a tampered body', () => {
    const body = '{"user":{"email":"trader@example.com"}}';
    const timestamp = '1700000000';
    const signature = `v1,${signSendEmailHook(secret, 'msg_1', timestamp, body)}`;

    expect(verifySendEmailHook({ secret, id: 'msg_1', timestamp, signature, body, now: 1700000000 })).toBe(true);
    expect(verifySendEmailHook({ secret, id: 'msg_1', timestamp, signature, body: `${body} `, now: 1700000000 })).toBe(false);
  });

  it('sends through Resend with a reply-to address and does not put the API key in the body', async () => {
    const message = buildAuthEmail(
      { user: { email: 'trader@example.com' }, email_data: { token_hash: 'hash-1', email_action_type: 'signup' } },
      { from: 'Option Market Traders <noreply@vastoptionmarkets.com>', replyTo: 'sonshasopunga@gmail.com', supabaseUrl: 'https://kgygsfqxiwlachohktql.supabase.co' },
    );
    let captured: { authorization?: string; body?: string } = {};
    await sendResendEmail(message, 're_test_key', async (_url, init) => {
      const headers = new Headers(init?.headers);
      captured = { authorization: headers.get('Authorization') ?? '', body: String(init?.body ?? '') };
      return new Response('{}', { status: 200 });
    });

    expect(captured.authorization).toBe('Bearer re_test_key');
    expect(captured.body).toContain('"reply_to":"sonshasopunga@gmail.com"');
    expect(captured.body).not.toContain('re_test_key');
  });

  it('fails within the timeout when Resend never answers', async () => {
    const message = buildAuthEmail(
      { user: { email: 'trader@example.com' }, email_data: { token_hash: 'hash-1', email_action_type: 'signup' } },
      { from: 'Option Market Traders <noreply@vastoptionmarkets.com>', replyTo: 'sonshasopunga@gmail.com', supabaseUrl: 'https://kgygsfqxiwlachohktql.supabase.co' },
    );
    const started = Date.now();

    await expect(sendResendEmail(message, 're_test_key', () => new Promise(() => {}), 50)).rejects.toBeInstanceOf(EmailSendTimeoutError);

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
