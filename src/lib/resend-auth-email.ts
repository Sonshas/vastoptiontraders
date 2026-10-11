import { createHmac, timingSafeEqual } from 'node:crypto';

const FIVE_MINUTES_IN_SECONDS = 5 * 60;

export type AuthEmailPayload = {
  user: { email?: string | null };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
    token_hash_new?: string;
  };
};

export type AuthEmailMessage = {
  from: string;
  to: string;
  replyTo: string | undefined;
  subject: string;
  html: string;
  text: string;
};

export function decodeHookSecret(secret: string): Buffer {
  const encoded = secret.trim().replace(/^v1,whsec_/, '');
  return Buffer.from(encoded, 'base64');
}

export function signSendEmailHook(secret: string, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', decodeHookSecret(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifySendEmailHook(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  now?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!input.id || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > FIVE_MINUTES_IN_SECONDS) return false;

  const expected = signSendEmailHook(input.secret, input.id, input.timestamp, input.body);
  return input.signature.split(' ').some((part) => {
    const value = part.startsWith('v1,') ? part.slice(3) : part;
    const actual = Buffer.from(value);
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  });
}

export function buildAuthEmail(payload: AuthEmailPayload, options: { from: string; replyTo?: string; supabaseUrl: string }): AuthEmailMessage {
  const to = payload.user.email?.trim() ?? '';
  if (!to) throw new Error('Registration email is missing a recipient.');

  const action = payload.email_data.email_action_type || 'signup';
  const tokenHash = action === 'email_change' && payload.email_data.token_hash_new
    ? payload.email_data.token_hash_new
    : payload.email_data.token_hash;
  if (!tokenHash) throw new Error('Registration email is missing a confirmation token.');

  const supabaseUrl = options.supabaseUrl.replace(/\/+$/, '');
  const redirectTo = payload.email_data.redirect_to || payload.email_data.site_url || '';
  const link = `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(action)}&redirect_to=${encodeURIComponent(redirectTo)}`;
  const copy = emailCopy(action);

  return {
    from: options.from,
    to,
    replyTo: options.replyTo || undefined,
    subject: copy.subject,
    text: `${copy.intro}\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${copy.intro}</p><p><a href="${escapeHtml(link)}">${copy.action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

function emailCopy(action: string): { subject: string; intro: string; action: string } {
  switch (action) {
    case 'recovery':
      return { subject: 'Reset your Option Market Traders password', intro: 'Use the link below to choose a new password.', action: 'Reset password' };
    case 'magiclink':
      return { subject: 'Your Option Market Traders sign-in link', intro: 'Use the link below to sign in.', action: 'Sign in' };
    case 'invite':
      return { subject: 'You are invited to Option Market Traders', intro: 'Use the link below to accept your invitation.', action: 'Accept invitation' };
    case 'email_change':
      return { subject: 'Confirm your new Option Market Traders email', intro: 'Use the link below to confirm this email address.', action: 'Confirm email' };
    case 'reauthentication':
      return { subject: 'Confirm your Option Market Traders sign-in', intro: 'Use the link below to confirm it is you.', action: 'Confirm sign-in' };
    default:
      return { subject: 'Confirm your Option Market Traders account', intro: 'Use the link below to finish creating your account.', action: 'Confirm account' };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export async function sendResendEmail(message: AuthEmailMessage, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      reply_to: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}).`);
  }
}
