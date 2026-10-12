import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, FlaskConical, RotateCcw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { calculateCompletedDeposits, calculateCompletedWithdrawals, calculateNetBalance } from '@/lib/funds';
import { MEGAPAY_MIN_DEPOSIT_KES, minimumDepositMessage, minimumDepositUsd, readMegaPayKesPerUsd, submitMegaPayStk } from '@/lib/megapay';
import { getWithdrawalTaxState } from '@/lib/withdrawal-tax';
import { useServerFn } from '@tanstack/react-start';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AccountDashboard() {
  const { user } = useSession();
  const qc = useQueryClient();
  const submitMegaPayRequest = useServerFn(submitMegaPayStk);
  const [selected, setSelected] = useState<'demo' | 'real'>('demo');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [fundsDialog, setFundsDialog] = useState<'deposit' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('MegaPay M-Pesa');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [taxAcknowledged, setTaxAcknowledged] = useState(false);

  const account = useQuery({ queryKey: ['practice-balance', user?.id], enabled: !!user, queryFn: async () => { const { data, error } = await supabase.rpc('get_practice_account'); if (error) throw error; return Number(data); } });
  const history = useQuery({ queryKey: ['practice-trades', user?.id], enabled: !!user, queryFn: async () => { const { data, error } = await supabase.from('practice_trades').select('*').order('created_at', { ascending: false }).limit(20); if (error) throw error; return data; } });
  const deposits = useQuery({ queryKey: ['my-deposits', user?.id], enabled: !!user, queryFn: async () => { const { data, error } = await supabase.from('deposits').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(50); if (error) throw error; return data; } });
  const withdrawals = useQuery({ queryKey: ['my-withdrawals', user?.id], enabled: !!user, queryFn: async () => { const { data, error } = await supabase.from('withdrawal_requests').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(50); if (error) throw error; return data; } });
  const taxSetting = useQuery({ queryKey: ['withdrawal-tax-amount'], staleTime: 60_000, queryFn: async () => { const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'withdrawal_tax_amount').maybeSingle(); if (error) throw error; const amount = Number(data?.value ?? 0); return Number.isFinite(amount) ? amount : 0; } });

  const rows = history.data ?? [];
  const profit = rows.reduce((sum, row) => sum + Number(row.profit), 0);
  const deposited = calculateCompletedDeposits(deposits.data ?? []);
  const withdrawn = calculateCompletedWithdrawals(withdrawals.data ?? []);
  const realBalance = calculateNetBalance(deposits.data ?? [], withdrawals.data ?? []);
  const taxCompliance = getWithdrawalTaxState({ hasCompletedDeposit: deposited > 0, taxAmount: taxSetting.data ?? 0 });
  const kesPerUsd = readMegaPayKesPerUsd();
  const depositAmount = Number(amount);
  const minDepositUsd = Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? minimumDepositUsd(kesPerUsd) : null;
  const estimatedKes = Number.isFinite(kesPerUsd) && kesPerUsd > 0 && Number.isFinite(depositAmount) && depositAmount > 0
    ? Math.round(depositAmount * kesPerUsd)
    : null;

  async function reset() {
    setResetting(true);
    try {
      const { data, error } = await supabase.rpc('reset_practice_account');
      if (error) throw error;
      qc.setQueryData(['practice-balance', user?.id], Number(data));
      setConfirmReset(false); toast.success('Demo balance reset to 10,000.00 USD');
    } catch { toast.error('Unable to reset your balance. Please try again.'); }
    finally { setResetting(false); }
  }

  async function submitFunds(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (fundsDialog === 'deposit') {
      if (!Number.isFinite(kesPerUsd) || kesPerUsd <= 0) {
        toast.error('Set a valid VITE_MEGAPAY_KES_PER_USD fixed exchange rate.');
        return;
      }
      if (!Number.isFinite(value) || Math.round(value * kesPerUsd) < MEGAPAY_MIN_DEPOSIT_KES) {
        toast.error(minimumDepositMessage(kesPerUsd));
        return;
      }
    } else if (!(value >= 10)) {
      toast.error('Minimum withdrawal is 10.00 USD.');
      return;
    }
    if (fundsDialog === 'deposit' || method === 'M-Pesa') {
      const cleanedPhone = phoneNumber.replace(/\s+/g, '').trim();
      if (!cleanedPhone) {
        toast.error(fundsDialog === 'deposit' ? 'Enter the M-Pesa phone number before submitting the deposit request.' : 'Enter the M-Pesa phone number before submitting the withdrawal request.');
        return;
      }
      const validNumber = /^(?:\+?254|254|0)?[17]\d{8}$/.test(cleanedPhone);
      if (!validNumber) { toast.error('Use a valid Kenyan M-Pesa phone number.'); return; }
    }
    if (fundsDialog === 'withdraw') {
      if (realBalance <= 0) { toast.error('You do not have any available balance to withdraw yet.'); return; }
      if (value > realBalance) { toast.error('Amount is more than your available balance.'); return; }
      if (taxCompliance.visible && !taxAcknowledged) { toast.error('Please confirm the tax compliance fee before requesting a withdrawal.'); return; }
    }
    setSubmitting(true);
    const paymentNote = fundsDialog === 'deposit' || method === 'M-Pesa' ? `M-Pesa number: ${phoneNumber.trim()}` : null;
    const withdrawalNote = [
      taxCompliance.visible ? `Tax compliance fee of ${money(taxCompliance.amount)} USD acknowledged.` : null,
      paymentNote,
    ].filter(Boolean).join(' | ');

    let megaPayDetails = '';
    if (fundsDialog === 'deposit') {
      let result;
      try {
        result = await submitMegaPayRequest({
          amountUsd: value,
          phoneNumber,
          reference: `deposit-${user!.id}-${Date.now()}`,
        });
      } catch {
        setSubmitting(false);
        toast.error('Unable to start the MegaPay STK request. Please try again.');
        return;
      }
      if (!result.ok) {
        setSubmitting(false);
        toast.error(result.message || 'MegaPay STK request failed.');
        return;
      }
      megaPayDetails = `MegaPay request: ${result.transactionRequestId} | KES ${result.amountKes} | USD/KES ${result.kesPerUsd}`;
    }

    const note = [
      paymentNote,
      megaPayDetails || null,
    ].filter(Boolean).join(' | ');

    let error: { message: string } | null = null;
    try {
      if (fundsDialog === 'deposit') {
        ({ error } = await supabase.from('deposits').insert({ user_id: user!.id, amount: value, method, note: note || null, status: 'pending' }));
      } else {
        ({ error } = await supabase.from('withdrawal_requests').insert({ user_id: user!.id, amount: value, method, note: withdrawalNote || null }));
      }
    } catch {
      setSubmitting(false);
      toast.error(fundsDialog === 'deposit' ? `STK was accepted but the deposit record failed to save. Reference: ${megaPayDetails}` : 'Unable to send the withdrawal request. Please try again.');
      return;
    }
    setSubmitting(false);
    if (error) {
      toast.error(fundsDialog === 'deposit' ? `MegaPay sent the STK prompt, but the pending deposit record could not be saved. Reference: ${megaPayDetails}` : error.message);
      return;
    }
    toast.success(fundsDialog === 'deposit' ? 'MegaPay STK prompt sent. Approve it on your phone; the deposit remains pending until confirmed.' : 'Withdrawal request sent. You will see it once processed.');
    setFundsDialog(null); setAmount(''); setPhoneNumber(''); setTaxAcknowledged(false);
    qc.invalidateQueries({ queryKey: ['my-deposits', user?.id] });
    qc.invalidateQueries({ queryKey: ['my-withdrawals', user?.id] });
  }

  const fundRows = [
    ...(deposits.data ?? []).map(d => ({ id: d.id, kind: 'Deposit', date: d.created_at, amount: Number(d.amount), status: d.status })),
    ...(withdrawals.data ?? []).map(w => ({ id: w.id, kind: 'Withdrawal', date: w.created_at, amount: -Number(w.amount), status: w.status })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 20);

  function openFundsDialog(type: 'deposit' | 'withdraw') {
    setFundsDialog(type);
    setAmount('');
    setPhoneNumber('');
    setMethod(type === 'deposit' ? 'MegaPay M-Pesa' : 'M-Pesa');
    setTaxAcknowledged(false);
  }

  return <main className="account-page container-wide">
    <div className="account-heading"><div><p className="section-kicker">YOUR TRADING ACCOUNTS</p><h1>Balance dashboard</h1></div><span className="account-currency">Account currency <strong>USD</strong></span></div>
    <div className="account-switch" role="tablist" aria-label="Account type">
      <Button variant="ghost" role="tab" aria-selected={selected === 'demo'} aria-controls="account-panel" id="demo-tab" className={selected === 'demo' ? 'selected' : ''} onClick={() => { setSelected('demo'); setConfirmReset(false); }}><FlaskConical /> Practice account <span className="account-tag">Virtual</span></Button>
      <Button variant="ghost" role="tab" aria-selected={selected === 'real'} aria-controls="account-panel" id="real-tab" className={selected === 'real' ? 'selected' : ''} onClick={() => { setSelected('real'); setConfirmReset(false); }}><img src="/usa-flag.svg" alt="USA flag" className="account-flag" /> Real account <span className="account-tag">USD</span></Button>
    </div>
    <section id="account-panel" role="tabpanel" aria-labelledby={`${selected}-tab`}>
      <div className="account-balance-band"><div><div className="account-balance-label"><Wallet size={18} /> {selected === 'demo' ? 'Available demo balance' : 'Real account balance'}</div><div className="account-balance-number">{selected === 'real' ? (deposits.isPending || withdrawals.isPending ? '…' : money(realBalance)) : account.isError ? 'Unavailable' : account.data != null ? money(account.data) : '…'} <span>USD</span></div><p>{selected === 'demo' ? 'Virtual funds · No real money at risk' : 'Funded by confirmed deposits'}</p></div><div className="account-balance-actions">{selected === 'demo' ? <><Button asChild size="lg"><Link to="/trade">Trade with demo <ArrowUpRight /></Link></Button><Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={account.isPending || account.isError || resetting}><RotateCcw /> Reset balance</Button></> : <><Button size="lg" onClick={() => openFundsDialog('deposit')}><ArrowDownToLine /> Deposit</Button><Button variant="outline" size="lg" onClick={() => openFundsDialog('withdraw')}><ArrowUpFromLine /> Withdraw</Button></>}</div></div>
      {account.isError && selected === 'demo' && <div className="account-notice" role="alert">Your balance could not be loaded.<Button variant="outline" onClick={() => void account.refetch()}>Try again</Button></div>}
      {confirmReset && selected === 'demo' && <div className="account-notice"><div><strong>Reset demo funds?</strong><p>Your balance will return to 10,000.00 USD. Trade history is kept.</p></div><div className="account-inline-actions"><Button variant="outline" onClick={() => setConfirmReset(false)} disabled={resetting}>Cancel</Button><Button onClick={reset} disabled={resetting}>{resetting ? 'Resetting…' : 'Confirm reset'}</Button></div></div>}
      {selected === 'real' ? <>
        <div className="account-stats"><div><span>Total deposited</span><strong>{deposits.isPending ? '—' : money(deposited)} <small>USD</small></strong></div><div><span>Total withdrawn</span><strong>{withdrawals.isPending ? '—' : money(withdrawn)} <small>USD</small></strong></div><div><span>Pending requests</span><strong>{deposits.isPending || withdrawals.isPending ? '—' : fundRows.filter(r => r.status === 'pending').length}</strong></div></div>
        <section className="account-activity"><div className="account-section-heading"><h2>Funds activity</h2><span>Deposits and withdrawals</span></div>{fundRows.length ? <div className="account-table-wrap"><table><thead><tr><th>Type</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{fundRows.map(row => <tr key={row.id}><td>{row.kind}</td><td>{new Date(row.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className={row.amount >= 0 ? 'up' : 'down'}>{row.amount >= 0 ? '+' : ''}{money(row.amount)} USD</td><td>{row.status}</td></tr>)}</tbody></table></div> : <div className="account-empty"><Wallet size={28} /><h3>No funds activity yet</h3><p>Use Deposit to fund your Real account.</p></div>}</section>
      </> : <>
        <div className="account-stats"><div><span>Recent profit / loss</span><strong className={profit >= 0 ? 'up' : 'down'}>{history.isError || history.isPending ? '—' : `${profit >= 0 ? '+' : ''}${money(profit)}`} <small>USD</small></strong></div><div><span>Trades in view</span><strong>{history.isError || history.isPending ? '—' : rows.length}</strong></div><div><span>Win rate</span><strong>{history.isError || history.isPending || !rows.length ? '—' : `${Math.round(rows.filter(row => row.won).length / rows.length * 100)}%`}</strong></div></div>
        <section className="account-activity"><div className="account-section-heading"><h2>Recent activity</h2><span>Latest 20 demo trades</span></div>{history.isError ? <div className="account-notice" role="alert">Activity could not be loaded.<Button variant="outline" onClick={() => void history.refetch()}>Try again</Button></div> : history.isPending ? <p className="account-empty">Loading activity…</p> : rows.length ? <div className="account-table-wrap"><table><thead><tr><th>Contract</th><th>Market</th><th>Date</th><th>Stake</th><th>Profit / loss</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.contract_type}{row.barrier != null ? ` ${row.barrier}` : ''}</td><td>Volatility {row.market.replace('R_', '')}</td><td>{new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>{money(Number(row.stake))}</td><td className={row.won ? 'up' : 'down'}>{Number(row.profit) >= 0 ? '+' : ''}{money(Number(row.profit))} USD</td></tr>)}</tbody></table></div> : <div className="account-empty"><Wallet size={28} /><h3>No trades yet</h3><p>Your demo trading activity will appear here.</p></div>}</section>
        <p className="account-footnote">Demo funds have no cash value and cannot be withdrawn.</p>
      </>}
    </section>
    <Dialog open={fundsDialog !== null} onOpenChange={open => { if (!open) { setFundsDialog(null); setAmount(''); setPhoneNumber(''); setTaxAcknowledged(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fundsDialog === 'deposit' ? 'Deposit to Real account' : 'Withdraw from Real account'}</DialogTitle>
          <DialogDescription>
            {fundsDialog === 'deposit'
              ? 'Send a deposit request. Your balance updates once the payment is confirmed.'
              : `Available balance: ${money(realBalance)} USD. Your request will be reviewed and processed.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submitFunds} className="grid gap-3">
          {fundsDialog === 'withdraw' && taxCompliance.visible && <div className="account-notice rounded-md" role="note"><div><strong>{taxCompliance.label}</strong><p>Compliance fee: {money(taxCompliance.amount)} USD. This reminder appears only after a completed deposit and before a withdrawal is requested.</p></div></div>}
          <Input aria-label="Amount" type="number" min={fundsDialog === 'deposit' ? (minDepositUsd ?? undefined) : 10} step="0.01" placeholder="Amount (USD)" value={amount} onChange={e => setAmount(e.target.value)} required />
          {fundsDialog === 'deposit'
            ? <p className="rounded-md border bg-secondary/50 px-3 py-2 text-sm">Payment method: MegaPay M-Pesa STK</p>
            : <select aria-label="Method" className="h-10 rounded-md border bg-background px-3" value={method} onChange={e => setMethod(e.target.value)}>
              <option value="M-Pesa">M-Pesa</option><option value="Bank transfer">Bank transfer</option><option value="Card">Card</option>
            </select>}
          {(fundsDialog === 'deposit' || method === 'M-Pesa') && fundsDialog !== null && (
            <Input
              aria-label="M-Pesa phone number"
              type="tel"
              inputMode="tel"
              placeholder="M-Pesa number (e.g. 0712345678)"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              required
            />
          )}
          {fundsDialog === 'deposit' && minDepositUsd != null && <p className="text-sm text-muted-foreground">Minimum deposit is KES 1,600 ({minDepositUsd.toFixed(2)} USD).</p>}
          {fundsDialog === 'deposit' && amount && (!Number.isFinite(kesPerUsd) || kesPerUsd <= 0) && <p className="text-sm text-destructive">Set a valid VITE_MEGAPAY_KES_PER_USD fixed exchange rate.</p>}
          {fundsDialog === 'deposit' && estimatedKes != null && estimatedKes < MEGAPAY_MIN_DEPOSIT_KES && <p className="text-sm text-destructive">{minimumDepositMessage(kesPerUsd)}</p>}
          {fundsDialog === 'deposit' && estimatedKes != null && estimatedKes >= MEGAPAY_MIN_DEPOSIT_KES && <p className="text-sm text-muted-foreground">MegaPay will request KES {estimatedKes.toLocaleString('en-KE')} at the fixed rate of {kesPerUsd} KES per USD.</p>}
          {fundsDialog === 'withdraw' && taxCompliance.visible && <label className="flex items-start gap-2 rounded-md border border-border bg-secondary/50 p-3 text-sm">
            <input type="checkbox" checked={taxAcknowledged} onChange={e => setTaxAcknowledged(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>I understand the tax compliance fee of {money(taxCompliance.amount)} USD and want to continue with this withdrawal.</span>
          </label>}
          <Button type="submit" disabled={submitting || (fundsDialog === 'withdraw' && taxCompliance.visible && !taxAcknowledged)}>{submitting ? 'Sending…' : fundsDialog === 'deposit' ? 'Send deposit request' : 'Request withdrawal'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
