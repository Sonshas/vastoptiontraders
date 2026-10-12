import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock3, TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/page-head';

export const Route = createFileRoute('/_authenticated/positions')({
  head: () => pageHead('Positions & Trade History | Option Market Traders', 'Review your latest demo and Real account digit contracts, stakes, exit digits and trading results on Option Market Traders.'),
  component: PositionsPage,
});

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SettledTrade = {
  id: string;
  contract_type: string;
  barrier: number | null;
  market: string;
  created_at: string;
  stake: number;
  exit_digit: number;
  won: boolean;
  profit: number;
};

function TradeList({ rows }: { rows: SettledTrade[] }) {
  return <div className="position-list">{rows.map(t => <article className="position-row" key={t.id}>
    <div className="position-row-heading"><strong>{t.contract_type.replace('_', ' / ')}{t.barrier != null ? ` ${t.barrier}` : ''}</strong><span className={t.won ? 'up' : 'down'}>{t.won ? 'Won' : 'Lost'}</span></div>
    <p className="position-market">Volatility {t.market.replace('R_', '')} Index · {new Date(t.created_at).toLocaleString()}</p>
    <dl className="position-details"><div><dt>Stake</dt><dd>{money(Number(t.stake))} USD</dd></div><div><dt>Exit digit</dt><dd>{t.exit_digit}</dd></div><div><dt>Profit / Loss</dt><dd className={t.won ? 'up' : 'down'}>{Number(t.profit) > 0 ? '+' : ''}{money(Number(t.profit))} USD</dd></div></dl>
  </article>)}</div>;
}

function PositionsPage() {
  const { user } = useSession();
  const history = useQuery({ queryKey: ['practice-trades', user?.id], queryFn: async () => {
    const { data, error } = await supabase.from('practice_trades').select('*').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data;
  } });
  const realHistory = useQuery({ queryKey: ['real-trades', user?.id], queryFn: async () => {
    const { data, error } = await supabase.from('real_trades').select('*').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data;
  } });
  return <><SiteHeader /><main className="positions-page container-wide">
    <header className="positions-heading"><div><p className="section-kicker">TRADE HISTORY</p><h1>Positions</h1><p className="text-muted-foreground text-sm mt-2">Settled demo and Real account trades</p></div><Button asChild variant="outline"><Link to="/trade"><TrendingUp /> Trade</Link></Button></header>
    <h2 className="text-lg font-semibold">Demo account</h2>
    {history.isPending ? <p role="status" className="text-muted-foreground">Loading positions…</p> : history.error ? <div role="alert"><p>Demo trade history could not be loaded.</p><Button variant="outline" onClick={() => history.refetch()}>Retry</Button></div> : history.data?.length ? <TradeList rows={history.data} /> : <div className="account-empty"><Clock3 /><h3>No demo positions yet</h3><Button asChild variant="outline"><Link to="/trade">Trade with demo</Link></Button></div>}
    <h2 className="text-lg font-semibold mt-8">Real account</h2>
    {realHistory.isPending ? <p role="status" className="text-muted-foreground">Loading real positions…</p> : realHistory.error ? <div role="alert"><p>Real trade history could not be loaded.</p><Button variant="outline" onClick={() => realHistory.refetch()}>Retry</Button></div> : realHistory.data?.length ? <TradeList rows={realHistory.data} /> : <div className="account-empty"><Clock3 /><h3>No real positions yet</h3><Button asChild variant="outline"><Link to="/trade">Trade with Real account</Link></Button></div>}
  </main></>;
}