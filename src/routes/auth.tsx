import { createFileRoute } from '@tanstack/react-router';
import { AuthForm, type AuthMode } from '@/components/auth-form';
import { SiteHeader } from '@/components/site-header';
import { pageHead } from '@/lib/page-head';

export const Route = createFileRoute('/auth')({
  validateSearch: (search: Record<string, unknown>): { mode: AuthMode } => ({ mode: search['mode'] === 'signup' || search['mode'] === 'forgot' ? search['mode'] : 'login' }),
  head: () => pageHead('Log in or sign up | Option Market Traders', 'Securely access your Option Market Traders account, create an account, or recover your password.'),
  component: AuthPage,
});
function AuthPage() { const { mode } = Route.useSearch(); return <><SiteHeader /><main className="auth-page"><AuthForm key={mode} mode={mode} /></main></>; }