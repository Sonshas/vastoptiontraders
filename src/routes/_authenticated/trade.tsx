import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, RotateCcw, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/site-header';
import { supabase } from '@/integrations/supabase/client';
import { useSession } from '@/components/session-context';
import { pageHead } from '@/lib/page-head';
import { loadAvailableRealBalance } from '@/lib/real-balance';
import { useSimulatedMarket } from '@/hooks/use-simulated-market';
import { MarketChart } from '@/components/market-chart';

export const Route = createFileRoute('/_authenticated/trade')({
  head: () => pageHead('Digit Trading | Option Market Traders', 'Practise Over/Under, Matches/Differs and Even/Odd digit contracts on simulated volatility markets with easy ~90% win-rate demo settlement.'),
  component: TradePage,
});

const MARKETS = [
  { id: 'R_10', name: 'Volatility 10 Index', vol: 0.1, decimals: 3, start: 6500 },
  { id: 'R_25', name: 'Volatility 25 Index', vol: 0.25, decimals: 3, start: 2400 },
  { id: 'R_50', name: 'Volatility 50 Index', vol: 0.5, decimals: 4, start: 230 },
  { id: 'R_75', name: 'Volatility 75 Index', vol: 0.75, decimals: 4, start: 51000 },
  { id: 'R_100', name: 'Volatility 100 Index', vol: 1, decimals: 2, start: 1300 },
] as const;
type Market = (typeof MARKETS)[number];
type Group = 'OVER_UNDER' | 'MATCHES_DIFFERS' | 'EVEN_ODD';
const GROUPS: { id: Group; label: string; sides: [string, string]; labels: [string, string] }[] = [
  { id: 'OVER_UNDER', label: 'Over / Under', sides: ['OVER', 'UNDER'], labels: ['Over', 'Under'] },
  { id: 'MATCHES_DIFFERS', label: 'Matches / Differs', sides: ['MATCHES', 'DIFFERS'], labels: ['Matches', 'Differs'] },
  { id: 'EVEN_ODD', label: 'Even / Odd', sides: ['EVEN', 'ODD'], labels: ['Even', 'Odd'] },
];
const lastDigit = (p: number, dec: number) => Number(p.toFixed(dec).slice(-1));
export const DEMO_WIN_RATE = 0.9;
export function probability(c: string, b: number) {
  if (c === 'EVEN' || c === 'ODD' || c === 'MATCHES' || c === 'DIFFERS' || c === 'OVER' || c === 'UNDER') {
    return DEMO_WIN_RATE;
  }
  return 0;
}
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


function TradePage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [market, setMarket] = useState<Market>(MARKETS[4]);
  const feed = useSimulatedMarket(market.id, market.decimals, market.start, market.vol);
  const ticks = feed.ticks.map(t => t.quote);
  const [group, setGroup] = useState<Group>('OVER_UNDER');
  const [barrier, setBarrier] = useState(5);
  const [stake, setStake] = useState('10');
  const [duration, setDuration] = useState(5);
  const [running, setRunning] = useState<null | { account: 'demo' | 'real'; contract: string; left: number; digit: number; won: boolean; profit: number; balance: number }>(null);
  const [lastResult, setLastResult] = useState<null | { account: 'demo' | 'real'; won: boolean; profit: number; digit: number }>(null);


  const account = useQuery({ queryKey: ['practice-balance', user?.id], queryFn: async () => { const { data, error } = await supabase.rpc('get_practice_account'); if (error) throw error; return Number(data); } });
  const [accountType, setAccountType] = useState<'demo' | 'real'>('demo');
  const isReal = accountType === 'real';
  const realFunds = useQuery({ queryKey: ['real-balance', user?.id], enabled: !!user && isReal, retry: false, queryFn: () => loadAvailableRealBalance(user!.id) });

  // Demo outcomes are settled by the simulator, independent of the displayed ticks.
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => {
      if (running.left > 1) { setRunning({ ...running, left: running.left - 1 }); return; }
      setLastResult({ account: running.account, won: running.won, profit: running.profit, digit: running.digit });
      if (running.account === 'real') {
        qc.setQueryData(['real-balance', user?.id], running.balance);
        void qc.invalidateQueries({ queryKey: ['real-balance', user?.id] });
        void qc.invalidateQueries({ queryKey: ['real-trades', user?.id] });
      } else {
        qc.setQueryData(['practice-balance', user?.id], running.balance);
        void qc.invalidateQueries({ queryKey: ['practice-trades', user?.id] });
      }
      const accountLabel = running.account === 'real' ? 'Real' : 'Demo';
      toast[running.won ? 'success' : 'error'](running.won ? `Won ${money(running.profit)} USD` : `Lost ${money(-running.profit)} USD`, { description: `${accountLabel} exit digit: ${running.digit}` });
      setRunning(null);
    }, 1000);
    return () => clearTimeout(id);
  }, [running, qc, user?.id]);

  const price = ticks[ticks.length - 1] ?? 0;
  const prev = ticks[ticks.length - 2] ?? price;
  const digit = ticks.length ? lastDigit(price, feed.decimals) : 0;
  const stats = useMemo(() => { const c = Array(10).fill(0); ticks.slice(-100).forEach(t => c[lastDigit(t, feed.decimals)]++); return c.map(n => (ticks.length ? (n / Math.min(ticks.length, 100)) * 100 : 0)); }, [ticks, feed.decimals]);
  const g = GROUPS.find(x => x.id === group) ?? GROUPS[0];
  const stakeNum = Number(stake);
  const validStake = stakeNum >= 0.35 && stakeNum <= 5000;
  const barrierOptions = group === 'EVEN_ODD' ? [] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  async function buy(contract: string): Promise<void> {
    if (running) return;
    if (!validStake) { toast.error('Stake must be between 0.35 and 5,000 USD'); return; }
    if (contract === 'OVER' && barrier > 8) { toast.error('Over needs a prediction from 0 to 8'); return; }
    if (contract === 'UNDER' && barrier < 1) { toast.error('Under needs a prediction from 1 to 9'); return; }
    if (isReal && (realFunds.data == null || stakeNum > realFunds.data)) {
      toast.error(realFunds.data == null ? 'Real balance is still loading.' : 'Stake is more than your available real balance.');
      return;
    }
    const settlementAccount = isReal ? 'real' as const : 'demo' as const;
    const { data, error } = await supabase.rpc(isReal ? 'place_real_trade' : 'place_practice_trade', { _market: market.id, _contract: contract, _barrier: group === 'EVEN_ODD' ? 0 : barrier, _stake: stakeNum });
    if (error) { toast.error(error.message); return; }
    const r = data as { exit_digit: number; won: boolean; profit: number; balance: number } | null;
    if (!r || typeof r.exit_digit !== 'number') { toast.error('Trade could not be settled.'); return; }
    if (settlementAccount === 'real') qc.setQueryData(['real-balance', user?.id], (b: number | undefined) => (b ?? 0) - stakeNum);
    else qc.setQueryData(['practice-balance', user?.id], (b: number | undefined) => (b ?? 0) - stakeNum);
    setLastResult(null);
    setRunning({ account: settlementAccount, contract, left: duration, digit: r.exit_digit, won: r.won, profit: Number(r.profit), balance: Number(r.balance) });
  }
  async function reset(): Promise<void> {
    const { error } = await supabase.rpc('reset_practice_account');
    if (error) { toast.error(error.message); return; }
    qc.setQueryData(['practice-balance', user?.id], 10000); toast.success('Practice balance reset to 10,000.00 USD');
  }

  if (!g) return null;
  return <div className="trade-shell"><SiteHeader /><main className="trade-page">
    <div className="trade-topbar">
      <select className="trade-select" value={market.id} onChange={e => { const next = MARKETS.find(m => m.id === e.target.value); if (next && !running) setMarket(next); }} disabled={!!running} aria-label="Market">{MARKETS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <div className="trade-balance"><Button asChild size="sm" className="trade-deposit-btn"><Link to="/dashboard"><ArrowDownToLine /> Deposit</Link></Button><Button asChild size="sm" variant="outline" className="trade-deposit-btn"><Link to="/dashboard"><ArrowUpFromLine /> Withdraw</Link></Button><div className="account-switcher" role="tablist" aria-label="Account type"><button role="tab" aria-selected={!isReal} className={!isReal ? 'selected' : ''} onClick={() => setAccountType('demo')} disabled={!!running}>Demo</button><button role="tab" aria-selected={isReal} className={isReal ? 'selected' : ''} onClick={() => setAccountType('real')} disabled={!!running}><img src="/usa-flag.svg" alt="" /> Real</button></div><span className="demo-badge">{isReal ? 'Real' : 'Demo'}</span><strong>{isReal ? (realFunds.data != null ? money(realFunds.data) : realFunds.isError ? '—' : '…') : account.data != null ? money(account.data) : '…'} USD</strong>{!isReal && <Button variant="ghost" size="icon" onClick={reset} aria-label="Reset practice balance" disabled={!!running}><RotateCcw /></Button>}</div>
    </div>
    <div className="trade-layout">
      <section className="trade-chart-card">
        <div className="live-market-heading"><div><p className="section-kicker">SIMULATED MARKET DATA</p><h1>{market.name}</h1></div><span className={`feed-status ${feed.status}`} role="status"><i />{feed.status === 'live' ? 'Live' : feed.status === 'connecting' ? 'Connecting' : 'Disconnected'}</span></div>
        <div className="live-market-price"><strong className={price >= prev ? 'up' : 'down'}>{ticks.length ? price.toFixed(feed.decimals) : '—'}</strong><span className={price >= prev ? 'up' : 'down'}>{ticks.length > 1 ? `${price >= prev ? '+' : ''}${(price - prev).toFixed(feed.decimals)}` : '—'}</span><small>{feed.updated ? new Date(feed.updated * 1000).toISOString().slice(11, 19) + ' UTC' : 'Awaiting prices'}</small></div>
        {feed.error && <div className="feed-error" role="alert">{feed.error}<Button variant="outline" size="sm" onClick={feed.reconnect}>Reconnect</Button></div>}
        <MarketChart ticks={feed.ticks} decimals={feed.decimals} symbol={market.id} />
        <div className="digit-stats-heading"><h2>Last digit distribution</h2><span>{Math.min(ticks.length, 100)} market ticks · Last digit {ticks.length ? digit : '—'}</span></div>
        <div className="digit-row" aria-label="Last digit statistics">{stats.map((s, d) => <div key={d} className={`digit-cell ${d === digit ? 'current' : ''} ${s === Math.max(...stats) ? 'hi' : ''} ${s === Math.min(...stats) ? 'lo' : ''}`}><span className="digit-num">{d}</span><small>{s.toFixed(1)}%</small></div>)}</div>
        <p className="trade-hint">Source: Option Market Traders · Simulated prices for practice only.</p>
        {running && <div className="trade-status">{running.account === 'real' ? 'Real' : 'Demo'} contract running: {running.contract.toLowerCase()} — {running.left} tick{running.left === 1 ? '' : 's'} left</div>}
        {lastResult && !running && <div className={`trade-status ${lastResult.won ? 'won' : 'lost'}`}>{lastResult.won ? `You won ${money(lastResult.profit)} USD` : `You lost ${money(-lastResult.profit)} USD`} — {lastResult.account === 'real' ? 'real' : 'demo'} exit digit {lastResult.digit}</div>}
      </section>
      <aside className="trade-panel">
        <div className="ticket-heading"><label className="ticket-contract"><span>Contract</span><select aria-label="Contract type" value={group} onChange={e => setGroup(e.target.value as Group)} disabled={!!running}>{GROUPS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label><Button asChild variant="ghost" size="sm"><Link to="/positions"><History /> Positions</Link></Button></div>
        {barrierOptions.length > 0 && <div className="prediction-control"><span className="trade-label">Digit</span><div className="tick-picker" aria-label="Last digit prediction">{barrierOptions.map(n => <Button variant="ghost" key={n} aria-label={`Predict digit ${n}`} aria-pressed={n === barrier} className={n === barrier ? 'active' : ''} onClick={() => setBarrier(n)} disabled={!!running}>{n}</Button>)}</div></div>}
        <div className="ticket-fields"><label className="ticket-field" htmlFor="duration"><span>Duration (seconds)</span><select id="duration" value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={!!running}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} second{n === 1 ? '' : 's'}</option>)}</select></label><label className="ticket-field" htmlFor="stake"><span>Stake (USD)</span><input id="stake" type="number" min={0.35} max={5000} step={0.01} value={stake} onChange={e => setStake(e.target.value)} disabled={!!running} /></label></div>
        <div className="ticket-buy-actions">{g.sides.map((c, i) => { const p = probability(c, barrier); const realBlocked = isReal && (realFunds.data == null || stakeNum > realFunds.data); const disabled = realBlocked || !!running || !validStake || (c === 'OVER' && barrier > 8) || (c === 'UNDER' && barrier < 1); const payout = validStake && p > 0 ? (stakeNum * 0.95) / p : 0; return <Button key={c} className={`buy-btn ${i === 0 ? 'buy-up' : 'buy-down'}`} onClick={() => buy(c)} disabled={disabled}>{i === 0 ? <TrendingUp /> : <TrendingDown />}<span><strong>{g.labels[i]}{group !== 'EVEN_ODD' ? ` ${barrier}` : ''}</strong><small>Payout {money(payout)} USD</small></span></Button>; })}</div>
        {isReal && realFunds.isError && <p className="ticket-disclaimer" role="alert">Real balance could not be loaded.</p>}
        {isReal && realFunds.data != null && validStake && stakeNum > realFunds.data && <p className="ticket-disclaimer" role="status">Stake is more than your available real balance.</p>}
        {running && <p className="ticket-disclaimer" role="status">{`${running.contract.replace('_', ' ')} · ${running.left}s remaining`}</p>}
      </aside>
    </div>
  </main></div>;
}
