import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Copy, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { useIsAdmin } from '@/routes/_authenticated/admin';
import {
  formatReferralUsd,
  parseReferralDashboard,
  referralUrl,
  type ReferralAdminSnapshot,
  type ReferralDashboard,
} from '@/lib/referral';

function referralErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : error instanceof Error ? error.message : '';
  if (/forbidden/i.test(message)) return 'You can only view your own referral dashboard.';
  if (/not found/i.test(message)) return 'That referral link does not match an admin.';
  return 'The referral dashboard could not be loaded.';
}

async function copyReferralLink(code: string) {
  const url = referralUrl(code, window.location.origin);
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Referral link copied');
  } catch {
    toast.error('Select the link and copy it manually.');
  }
}

function ReferralLinkField({ code }: { code: string }) {
  const url = referralUrl(code, typeof window === 'undefined' ? undefined : window.location.origin);
  return (
    <div className="flex flex-wrap gap-3">
      <Input aria-label="Referral link" readOnly className="min-w-0 flex-1" value={url} />
      <Button type="button" variant="outline" onClick={() => void copyReferralLink(code)}>
        <Copy /> Copy link
      </Button>
    </div>
  );
}

function ReferredUsers({ admin }: { admin: ReferralAdminSnapshot }) {
  if (!admin.referred_users.length) {
    return <p className="text-sm text-muted-foreground">No one has joined through this link yet.</p>;
  }
  return (
    <div className="space-y-4">
      {admin.referred_users.map(user => (
        <article key={`${user.email}-${user.joined_at}`} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">{user.email}</h3>
            <p className="text-sm text-muted-foreground">Joined {new Date(user.joined_at).toLocaleString()}</p>
          </div>
          <p className="mt-2 text-sm">
            Completed deposits {formatReferralUsd(user.deposit_total)} USD · Referral commission {formatReferralUsd(user.commission_total)} USD
          </p>
          {user.completed_deposits.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {user.completed_deposits.map((deposit, index) => (
                <li key={`${deposit.completed_at}-${deposit.amount}-${index}`}>
                  {new Date(deposit.completed_at).toLocaleString()} · {formatReferralUsd(deposit.amount)} USD deposit · {deposit.commission == null ? 'No commission recorded' : `${formatReferralUsd(deposit.commission)} USD referral commission`}
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted-foreground">No completed deposits yet.</p>}
        </article>
      ))}
    </div>
  );
}

function AdminReferralCard({ admin, yours, superView }: { admin: ReferralAdminSnapshot; yours: boolean; superView: boolean }) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{yours ? 'Your referral link' : admin.email}</h2>
          <p className="text-sm text-muted-foreground">{yours ? admin.email : 'Admin referral dashboard'}</p>
        </div>
        {superView && (
          <Button asChild variant="outline">
            <Link to="/referrals" search={{ code: admin.code }}>Open dashboard</Link>
          </Button>
        )}
      </div>
      <ReferralLinkField code={admin.code} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground">Referral commission</p>
          <p className="text-2xl font-bold">{formatReferralUsd(admin.commission_total)} USD</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Referred users</p>
          <p className="text-2xl font-bold">{admin.referred_users.length}</p>
        </div>
      </div>
      <ReferredUsers admin={admin} />
    </Card>
  );
}

function DashboardBody({ data }: { data: ReferralDashboard }) {
  if (data.scope === 'all') {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">Every admin referral dashboard is listed here. Other admins can see only their own.</p>
        {data.admins?.length ? data.admins.map(admin => (
          <AdminReferralCard key={admin.code} admin={admin} yours={admin.code === data.own_code} superView />
        )) : <p className="text-sm text-muted-foreground">No admin referral links yet.</p>}
      </div>
    );
  }
  if (!data.admin) return null;
  return (
    <div className="space-y-4">
      {data.is_super_admin && (
        <Button asChild variant="outline">
          <Link to="/referrals" search={{}}>View all admin dashboards</Link>
        </Button>
      )}
      <AdminReferralCard admin={data.admin} yours={data.admin.code === data.own_code} superView={false} />
    </div>
  );
}

export function ReferralDashboard({ code }: { code?: string | undefined }) {
  const admin = useIsAdmin();
  const { user } = useSession();
  const dashboard = useQuery({
    queryKey: ['referral-dashboard', user?.id, code ?? ''],
    enabled: admin.data === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_referral_dashboard', { _code: code ?? '' });
      if (error) throw error;
      return parseReferralDashboard(data);
    },
  });

  if (admin.isPending) {
    return <><SiteHeader /><main className="container-wide py-10"><p role="status">Checking access…</p></main></>;
  }
  if (!admin.data) {
    return <><SiteHeader /><main className="container-wide py-16 text-center"><ShieldCheck className="mx-auto mb-3" /><h1 className="text-2xl font-bold">Admins only</h1><p className="text-muted-foreground mt-2">This account does not have access to referral dashboards.</p><Button asChild variant="outline" className="mt-6"><Link to="/dashboard">Back to dashboard</Link></Button></main></>;
  }

  return <><SiteHeader /><main className="container-wide space-y-6 py-8 pb-28">
    <header>
      <p className="section-kicker">REFERRALS</p>
      <h1 className="text-3xl font-bold">Referral dashboard</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Referral commission is 30% of each completed USD deposit from people who join through an admin link. Pending and rejected deposits pay nothing. This ledger is separate from trading balances and is not a withdrawal.
      </p>
    </header>
    {dashboard.isPending ? <p role="status">Loading referral dashboard…</p> : null}
    {dashboard.error ? <p role="alert">{referralErrorMessage(dashboard.error)}</p> : null}
    {dashboard.data ? <DashboardBody data={dashboard.data} /> : null}
  </main></>;
}
