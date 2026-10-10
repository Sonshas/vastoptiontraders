import { createFileRoute } from '@tanstack/react-router';
import { AccountDashboard } from '@/components/account-dashboard';
import { SiteHeader } from '@/components/site-header';
import { pageHead } from '@/lib/page-head';

export const Route = createFileRoute('/_authenticated/dashboard')({
  head: () => pageHead('Balance Dashboard | Option Market Traders', 'View your demo balance and recent trading activity, reset virtual funds, and check Real account availability.'),
  component: () => <><SiteHeader /><AccountDashboard /></>,
});