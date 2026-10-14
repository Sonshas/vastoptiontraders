import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useSession } from '@/components/session-context';
import { clearReferralCode, readReferralCode, signupOptions } from '@/lib/referral';

export type AuthMode = 'login' | 'signup' | 'forgot';
export function AuthForm({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { user } = useSession();
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (mode === 'forgot') {
        const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) throw result.error;
        setMessage('If an account exists for this email, you’ll receive a password reset link shortly.');
      } else if (mode === 'signup') {
        const referralCode = readReferralCode();
        const result = await supabase.auth.signUp({ email, password, options: signupOptions(window.location.origin, referralCode) });
        if (result.error) throw result.error;
        if (referralCode) clearReferralCode();
        if (result.data.session) await navigate({ to: '/trade' });
        else setMessage('Check your email to confirm your account. After confirmation, you can log in.');
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        await navigate({ to: '/trade' });
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  if (user) {
    return (
      <div className="auth-panel">
        <ShieldCheck className="text-primary" />
        <h1>You’re logged in</h1>
        <p>Welcome to Option Market Traders.</p>
        <Button asChild variant="hero">
          <Link to="/">Back to home <ArrowRight /></Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <div className="section-kicker">OPTION MARKET TRADERS</div>
      <h1>{mode === 'signup' ? 'Your next chapter starts here.' : mode === 'forgot' ? 'Reset your password' : 'Welcome back.'}</h1>
      <p>{mode === 'signup' ? 'Create your account and take the first step.' : mode === 'forgot' ? 'Enter your email and we’ll send you a reset link.' : 'Log in to your Option Market Traders account.'}</p>

      {message ? (
        <div className="auth-success" role="status">{message}</div>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="email">Email address</label>
            <Input id="email" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          {mode !== 'forgot' && (
            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <div className="password-wrap">
                <Input id="password" type={visible ? 'text' : 'password'} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : 1} required value={password} onChange={e => setPassword(e.target.value)} />
                <Button type="button" variant="ghost" size="icon" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button>
              </div>
            </div>
          )}

          {mode === 'login' && (
            <Link className="text-primary text-xs" to="/auth" search={{ mode: 'forgot' }}>Forgot password?</Link>
          )}

          {error && <div role="alert" className="auth-error">{error}</div>}

          <Button variant="hero" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Log in'} <ArrowRight />
          </Button>
        </form>
      )}

      <div className="auth-switch">
        {mode === 'login' ? (
          <>
            New here? <Link to="/auth" search={{ mode: 'signup' }}>Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link to="/auth" search={{ mode: 'login' }}>Log in</Link>
          </>
        )}
      </div>

      {mode === 'signup' && (
        <p className="auth-legal">By creating an account, you confirm you are at least 18 years old. Trading involves risk and may not be suitable for everyone.</p>
      )}
    </div>
  );
}