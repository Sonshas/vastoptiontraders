import { createFileRoute } from '@tanstack/react-router';
import { AuthForm, type AuthMode } from '@/components/auth-form';
import { SiteHeader } from '@/components/site-header';
import { normalizeReferralCode } from '@/lib/referral';
import { pageHead } from '@/lib/page-head';

export const Route = createFileRoute('/auth')({
  validateSearch: (search: Record<string, unknown>): { mode: AuthMode; ref?: string } => {
    const mode = search['mode'] === 'signup' || search['mode'] === 'forgot' ? search['mode'] : 'login';
    const ref = normalizeReferralCode(typeof search['ref'] === 'string' ? search['ref'] : null);
    return ref ? { mode, ref } : { mode };
  },
  head: () => pageHead('Log in or sign up | Option Market Traders', 'Securely access your Option Market Traders account, create an account, or recover your password.'),
  component: AuthPage,
});
function AuthPage() { const { mode, ref } = Route.useSearch(); return <><SiteHeader /><main className="auth-page"><AuthForm key={`${mode}-${ref ?? ''}`} mode={mode} referralCode={ref} /></main></>; }