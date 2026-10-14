import { createFileRoute } from '@tanstack/react-router';
import { ReferralDashboard } from '@/components/referral-dashboard';
import { pageHead } from '@/lib/page-head';
import { normalizeReferralCode } from '@/lib/referral';

export const Route = createFileRoute('/_authenticated/referrals')({
  validateSearch: (search: Record<string, unknown>): { code?: string } => {
    const rawCode = search['code'];
    const code = typeof rawCode === 'string' ? normalizeReferralCode(rawCode) : null;
    return code ? { code } : {};
  },
  head: () => pageHead('Referral dashboard | Option Market Traders', 'View your Option Market Traders referral link, referred users, and referral commission.'),
  component: ReferralsPage,
});

function ReferralsPage() {
  const { code } = Route.useSearch();
  return <ReferralDashboard code={code} />;
}
