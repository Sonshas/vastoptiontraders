import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SiteHeader } from '@/components/site-header';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/page-head';
import { useSession } from '@/components/session-context';

export const Route = createFileRoute('/reset-password')({ head: () => pageHead('Reset password | Option Market Traders', 'Choose a new password for your Option Market Traders account.'), component: ResetPassword });
function ResetPassword() {
  const { recovery } = useSession();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const isRecovery = recovery || window.location.hash.includes('type=recovery'); if (!isRecovery) return; void supabase.auth.getUser().then(({ data }) => setReady(Boolean(data.user))); const timer = window.setTimeout(() => { void supabase.auth.getUser().then(({ data }) => setReady(Boolean(data.user))); }, 1200); return () => window.clearTimeout(timer); }, [recovery]);
  async function submit(e: FormEvent) { e.preventDefault(); if (password !== confirm) { setError('Passwords do not match.'); return; } setBusy(true); setError(''); const { error: issue } = await supabase.auth.updateUser({ password }); if (issue) setError(issue.message); else setDone(true); setBusy(false); }
  return <><SiteHeader /><main className="auth-page"><div className="auth-panel"><h1>Set a new password</h1>{done ? <><div className="auth-success" role="status">Your password has been updated.</div><Button asChild className="mt-6"><Link to="/">Back to home</Link></Button></> : ready ? <form className="auth-form" onSubmit={submit}><div className="auth-field"><label htmlFor="new-password">New password</label><Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></div><div className="auth-field"><label htmlFor="confirm-password">Confirm password</label><Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} /></div>{error && <div role="alert" className="auth-error">{error}</div>}<Button variant="hero" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</Button></form> : <><p>Open the password reset link from your email to continue. If the link has expired, request a new one.</p><Button asChild><Link to="/auth" search={{ mode: 'forgot' }}>Request reset link</Link></Button></>}</div></main></>;
}