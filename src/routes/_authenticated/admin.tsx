import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheck, Users, Banknote, Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { DEFAULT_SITE_NAME, useSiteName } from '@/hooks/use-site-name';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/page-head';

export const Route = createFileRoute('/_authenticated/admin')({
  head: () => pageHead('Admin Panel | Option Market Traders', 'Admin overview of all Option Market Traders users, demo balances and deposit records.'),
  component: AdminPage,
});

const money = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function useIsAdmin() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['is-admin', user?.id], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_role', { _user_id: user!.id, _role: 'admin' });
      if (error) throw error;
      return !!data;
    },
  });
}

function AdminPage() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const { user } = useSession();
  const users = useQuery({ queryKey: ['admin-users'], enabled: admin.data === true, queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) throw error; return data;
  } });
  const deposits = useQuery({ queryKey: ['admin-deposits'], enabled: admin.data === true, queryFn: async () => {
    const { data, error } = await supabase.from('deposits').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error; return data;
  } });
  const withdrawals = useQuery({ queryKey: ['admin-withdrawals'], enabled: admin.data === true, queryFn: async () => {
    const { data, error } = await supabase.from('withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error; return data;
  } });
  const [form, setForm] = useState({ userId: '', amount: '', method: 'PayHero M-Pesa', status: 'completed', note: '' });
  const [saving, setSaving] = useState(false);
  const siteName = useSiteName();
  const [nameDraft, setNameDraft] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const nameValue = nameTouched ? nameDraft : siteName;
  const taxAmount = useQuery({ queryKey: ['withdrawal-tax-amount'], staleTime: 60_000, queryFn: async () => {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'withdrawal_tax_amount').maybeSingle();
    if (error) throw error;
    const amount = Number(data?.value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  } });
  const [taxDraft, setTaxDraft] = useState('');
  const [taxTouched, setTaxTouched] = useState(false);
  const taxValue = taxTouched ? taxDraft : String(taxAmount.data ?? 0);

  async function saveSiteName(e: React.FormEvent) {
    e.preventDefault();
    const value = nameValue.trim();
    if (value.length < 2 || value.length > 60) { toast.error('Name must be 2–60 characters.'); return; }
    const { error } = await supabase.from('site_settings').upsert({ key: 'site_name', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { toast.error(error.message); return; }
    toast.success('Site name updated');
    setNameTouched(false);
    qc.invalidateQueries({ queryKey: ['site-name'] });
  }

  async function saveTaxAmount(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(taxValue);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Tax compliance fee must be zero or greater.'); return; }
    const { error } = await supabase.from('site_settings').upsert({ key: 'withdrawal_tax_amount', value: String(amount), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { toast.error(error.message); return; }
    toast.success('Withdrawal compliance fee updated');
    setTaxTouched(false);
    qc.invalidateQueries({ queryKey: ['withdrawal-tax-amount'] });
  }
  const emailOf = (id: string) => users.data?.find(u => u.user_id === id)?.email ?? id.slice(0, 8);

  async function addDeposit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.userId || !(amount > 0)) { toast.error('Choose a user and enter an amount.'); return; }
    setSaving(true);
    const { error } = await supabase.from('deposits').insert({ user_id: form.userId, amount, method: form.method, status: form.status, note: form.note || null, created_by: user?.id ?? null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Deposit recorded');
    setForm(f => ({ ...f, amount: '', note: '' }));
    qc.invalidateQueries({ queryKey: ['admin-deposits'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from('deposits').update({ status }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['admin-deposits'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  }
  async function setWithdrawalStatus(id: string, status: string) {
    const { error } = await supabase.from('withdrawal_requests').update({ status }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['admin-withdrawals'] });
  }

  if (admin.isPending) return <><SiteHeader /><main className="container-wide py-10"><p role="status">Checking access…</p></main></>;
  if (!admin.data) return <><SiteHeader /><main className="container-wide py-16 text-center"><ShieldCheck className="mx-auto mb-3" /><h1 className="text-2xl font-bold">Admins only</h1><p className="text-muted-foreground mt-2">This account doesn't have access to the admin panel.</p><Button asChild variant="outline" className="mt-6"><Link to="/dashboard">Back to dashboard</Link></Button></main></>;

  const totalCompleted = (deposits.data ?? []).filter(d => d.status === 'completed').reduce((s, d) => s + Number(d.amount), 0);
  const pending = (deposits.data ?? []).filter(d => d.status === 'pending').length;

  return <><SiteHeader /><main className="container-wide py-8 pb-28 space-y-8">
    <header><p className="section-kicker">ADMIN</p><h1 className="text-3xl font-bold">Admin panel</h1><p className="text-muted-foreground text-sm mt-1">Review live PayHero deposits and withdrawal requests, then approve or reject them as needed.</p></header>

    <div className="grid gap-4 sm:grid-cols-3">
      <Card className="p-5"><Users className="mb-2 text-primary" /><p className="text-sm text-muted-foreground">Users</p><p className="text-2xl font-bold">{users.data?.length ?? '—'}</p></Card>
      <Card className="p-5"><Banknote className="mb-2 text-primary" /><p className="text-sm text-muted-foreground">Completed deposits</p><p className="text-2xl font-bold">{money(totalCompleted)} USD</p></Card>
      <Card className="p-5"><Plus className="mb-2 text-primary" /><p className="text-sm text-muted-foreground">Pending deposits</p><p className="text-2xl font-bold">{pending}</p></Card>
    </div>

    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Settings2 className="text-primary" size={18} /> Site settings</h2>
      <p className="text-sm text-muted-foreground mb-4">This name appears in the site header for every visitor.</p>
      <form onSubmit={saveSiteName} className="flex flex-wrap gap-3">
        <Input aria-label="Site name" className="max-w-xs" placeholder={DEFAULT_SITE_NAME} value={nameValue} onChange={e => { setNameTouched(true); setNameDraft(e.target.value); }} />
        <Button type="submit">Save name</Button>
      </form>
      <div className="mt-6 border-t pt-4">
        <p className="text-sm text-muted-foreground mb-3">Withdrawal compliance fee shown only after a user has deposited and then tries to withdraw.</p>
        <form onSubmit={saveTaxAmount} className="flex flex-wrap gap-3">
          <Input aria-label="Tax compliance fee" type="number" min="0" step="0.01" className="max-w-xs" placeholder="0.00" value={taxValue} onChange={e => { setTaxTouched(true); setTaxDraft(e.target.value); }} />
          <Button type="submit">Save fee</Button>
        </form>
      </div>
    </Card>

    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4">Users</h2>
      {users.error ? <p role="alert">Users could not be loaded.</p> : <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Joined</TableHead><TableHead>Last sign-in</TableHead><TableHead className="text-right">Demo balance</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">Deposits</TableHead></TableRow></TableHeader>
        <TableBody>{users.data?.map(u => <TableRow key={u.user_id}>
          <TableCell className="font-medium">{u.email}</TableCell>
          <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
          <TableCell>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : 'Never'}</TableCell>
          <TableCell className="text-right">{money(u.demo_balance)}</TableCell>
          <TableCell className="text-right">{u.trade_count}</TableCell>
          <TableCell className="text-right">{money(u.total_deposits)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </Card>

    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4">Record a deposit</h2>
      <form onSubmit={addDeposit} className="grid gap-3 sm:grid-cols-5">
        <select aria-label="User" className="trade-select h-10 rounded-md border bg-background px-3" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
          <option value="">Select user…</option>{users.data?.map(u => <option key={u.user_id} value={u.user_id}>{u.email}</option>)}
        </select>
        <Input aria-label="Amount" type="number" min="0.01" step="0.01" placeholder="Amount (USD)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
        <Input aria-label="Method" placeholder="Method" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} />
        <select aria-label="Status" className="h-10 rounded-md border bg-background px-3" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          <option value="completed">Completed</option><option value="pending">Pending</option><option value="rejected">Rejected</option>
        </select>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add deposit'}</Button>
        <Input aria-label="Note" className="sm:col-span-5" placeholder="Note (optional)" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      </form>
    </Card>

    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4">Deposits</h2>
      {deposits.data?.length ? <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
        <TableBody>{deposits.data.map(d => <TableRow key={d.id}>
          <TableCell>{new Date(d.created_at).toLocaleString()}</TableCell>
          <TableCell>{emailOf(d.user_id)}</TableCell>
          <TableCell>{d.method}</TableCell>
          <TableCell className="text-right">{money(Number(d.amount))} USD</TableCell>
          <TableCell><select aria-label="Change status" className="h-8 rounded-md border bg-background px-2 text-sm" value={d.status} onChange={e => setStatus(d.id, e.target.value)}>
            <option value="completed">Completed</option><option value="pending">Pending</option><option value="rejected">Rejected</option></select></TableCell>
          <TableCell className="text-muted-foreground">{d.note}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div> : <p className="text-muted-foreground text-sm">No deposits recorded yet.</p>}
    </Card>

    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4">Withdrawal requests</h2>
      {withdrawals.data?.length ? <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
        <TableBody>{withdrawals.data.map(w => <TableRow key={w.id}>
          <TableCell>{new Date(w.created_at).toLocaleString()}</TableCell>
          <TableCell>{emailOf(w.user_id)}</TableCell>
          <TableCell>{w.method}</TableCell>
          <TableCell className="text-right">{money(Number(w.amount))} USD</TableCell>
          <TableCell><select aria-label="Change status" className="h-8 rounded-md border bg-background px-2 text-sm" value={w.status} onChange={e => setWithdrawalStatus(w.id, e.target.value)}>
            <option value="completed">Completed</option><option value="pending">Pending</option><option value="rejected">Rejected</option></select></TableCell>
          <TableCell className="text-muted-foreground">{w.note}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div> : <p className="text-muted-foreground text-sm">No withdrawal requests yet.</p>}
    </Card>
  </main></>;
}
