import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { House, TrendingUp, Clock3, Menu, LogOut, ArrowUpRight, ArrowDownToLine, ArrowUpFromLine, Wallet, ShieldCheck, Share2 } from 'lucide-react';
import { useCanOpenReferralDashboard } from '@/hooks/use-referral-access';
import { useIsAdmin } from '@/routes/_authenticated/admin';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/theme-toggle';

export function TradingNavigation() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canOpenReferrals = useCanOpenReferralDashboard();
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error(error.message); return; }
    qc.clear();
    setOpen(false);
    await navigate({ to: '/auth', search: { mode: 'login' } });
  }
  const items = [
    { to: '/dashboard' as const, label: 'Dashboard', icon: House },
    { to: '/trade' as const, label: 'Trade', icon: TrendingUp },
    { to: '/positions' as const, label: 'Positions', icon: Clock3 },
  ];
  return <>
    <nav className="trading-bottom-nav" aria-label="Trading navigation">
      {items.map(item => <Button key={item.to} asChild variant="ghost" className={!open && pathname === item.to ? 'selected' : ''}><Link to={item.to} aria-current={!open && pathname === item.to ? 'page' : undefined}><item.icon /><span>{item.label}</span></Link></Button>)}
      <Button variant="ghost" className={open ? 'selected' : ''} onClick={() => setOpen(true)} aria-expanded={open}><Menu /><span>Menu</span></Button>
    </nav>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="trading-menu">
      <DialogTitle>Menu</DialogTitle><DialogDescription>Option Market Traders · Demo account</DialogDescription>
      <div className="trading-menu-links">
        <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/dashboard" search={{ action: 'deposit' }}><ArrowDownToLine /> Deposit <ArrowUpRight /></Link></Button>
        <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/dashboard" search={{ action: 'withdraw' }}><ArrowUpFromLine /> Withdraw <ArrowUpRight /></Link></Button>
        <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/dashboard"><Wallet /> Accounts <ArrowUpRight /></Link></Button>
        <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/positions"><Clock3 /> Trade history <ArrowUpRight /></Link></Button>
        <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/"><House /> Welcome page <ArrowUpRight /></Link></Button>
        {canOpenReferrals.data && <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/referrals" search={{}}><Share2 /> Referral dashboard <ArrowUpRight /></Link></Button>}
        {isAdmin.data && <Button asChild variant="ghost" onClick={() => setOpen(false)}><Link to="/admin"><ShieldCheck /> Admin panel <ArrowUpRight /></Link></Button>}
        <ThemeToggle labeled />
        <Button variant="ghost" onClick={signOut}><LogOut /> Log out</Button>
      </div>
    </DialogContent></Dialog>
  </>;
}