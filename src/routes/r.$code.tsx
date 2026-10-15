import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SiteHeader } from '@/components/site-header';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/page-head';
import { decideReferralLink, normalizeReferralCode, rememberReferralCode } from '@/lib/referral';

export const Route = createFileRoute('/r/$code')({
  head: () => pageHead('Referral | Option Market Traders', 'Open an Option Market Traders referral link and create your account.'),
  component: ReferralLinkPage,
});

function ReferralLinkPage() {
  const { code } = Route.useParams();
  const { user, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    async function continueFromLink() {
      if (!user) {
        rememberReferralCode(code);
        await navigate({ to: '/auth', search: { mode: 'signup' }, replace: true });
        return;
      }
      const normalized = normalizeReferralCode(code);
      let access: string | null = null;
      if (normalized) {
        const { data, error } = await supabase.rpc('referral_link_access', { _code: normalized });
        if (cancelled) return;
        access = !error && typeof data === 'string' ? data : null;
      }
      let canOpenOwnWallet = false;
      if (access !== 'owner' && access !== 'super') {
        const opened = await supabase.rpc('can_open_referral_dashboard');
        if (cancelled) return;
        canOpenOwnWallet = opened.data === true;
      }
      const decision = decideReferralLink({
        loggedIn: true,
        code: normalized,
        access,
        canOpenOwnWallet,
      });
      if (decision.kind === 'dashboard') {
        await navigate({ to: '/referrals', search: { code: decision.code }, replace: true });
        return;
      }
      if (decision.kind === 'own-wallet') {
        await navigate({ to: '/referrals', search: {}, replace: true });
        return;
      }
      await navigate({ to: '/trade', replace: true });
    }

    void continueFromLink();
    return () => { cancelled = true; };
  }, [code, loading, navigate, user]);

  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        <div className="auth-panel">
          <div className="section-kicker">REFERRAL</div>
          <h1>Opening your referral link</h1>
          <p role="status">Taking you to the next step.</p>
          <p>
            <Link to="/auth" search={{ mode: 'signup' }}>Continue to create an account</Link>
          </p>
        </div>
      </main>
    </>
  );
}
