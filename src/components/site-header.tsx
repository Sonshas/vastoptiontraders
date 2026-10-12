import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Globe, Menu, X, LogOut, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/brand';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { ThemeToggle } from '@/components/theme-toggle';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: '/auth', search: { mode: 'login' }, replace: true });
  }
  return <header className="site-header"><div className="container-wide header-inner"><Brand /><nav className="desktop-nav" aria-label="Main navigation"><a className="nav-link" href="/#markets">Markets <ChevronDown /></a><a className="nav-link" href="/#platform">Trading experience <ChevronDown /></a><a className="nav-link" href="/#get-started">Get started <ChevronDown /></a><a className="nav-link" href="/#about">About us</a></nav><div className="header-actions">{user ? <><Button asChild variant="ghost" size="icon" aria-label="Balance dashboard" title="Balance dashboard"><Link to="/dashboard"><Wallet /></Link></Button><Button asChild className="signup-button"><Link to="/trade">Trade</Link></Button><Button variant="outline" onClick={signOut}><LogOut /> Log out</Button></> : <><Button asChild variant="outline"><Link to="/auth" search={{ mode: 'login' }}>Log in</Link></Button><Button asChild className="signup-button"><Link to="/auth" search={{ mode: 'signup' }}>Create account</Link></Button></>}<ThemeToggle /><span className="language"><Globe size={15} /> EN</span><Button className="mobile-menu-button" variant="ghost" size="icon" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button></div></div>{open && <nav className="mobile-nav" aria-label="Mobile navigation">{[['Markets', 'markets'], ['Trading experience', 'platform'], ['Get started', 'get-started'], ['About us', 'about']].map(([label, id]) => <a key={id} href={`/#${id}`} className="nav-link" onClick={() => setOpen(false)}>{label}</a>)}</nav>}</header>;
}