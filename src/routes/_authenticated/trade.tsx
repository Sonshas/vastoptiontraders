import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, LoaderCircle, RotateCcw, ScanSearch, TrendingUp, TrendingDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SiteHeader } from '@/components/site-header';
import { supabase } from '@/integrations/supabase/client';
import { useSession } from '@/components/session-context';
import { pageHead } from '@/lib/page-head';
import { quotedPayout } from '@/lib/payout';
import { heldCursorDigit, lastDigitOfQuote, quoteWithLastDigit } from '@/lib/practice-win-rate';
import { loadAvailableRealBalance } from '@/lib/real-balance';
import { useSimulatedMarket } from '@/hooks/use-simulated-market';
import { MarketChart } from '@/components/market-chart';
import { addSessionProfit, autoTradeDecision, buildScanSequence, DEFAULT_STOP_LOSS, DEFAULT_TARGET_PROFIT, formatUsd, loadedScanMatches, SCAN_CONTRACTS, SCAN_FRAME_MS, scanContractGroup, scanContractLabel, sessionNoticeCopy, type LoadedScan, type ScanChoice } from '@/lib/auto-trade';

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
type AccountKind = 'demo' | 'real';
type Settlement = { exit_digit: number; won: boolean; profit: number; balance: number };
type RunningTrade = { account: AccountKind; contract: string; left: number; digit: number; won: boolean; profit: number; balance: number };
const GROUPS: { id: Group; label: string; sides: [string, string]; labels: [string, string] }[] = [
  { id: 'OVER_UNDER', label: 'Over / Under', sides: ['OVER', 'UNDER'], labels: ['Over', 'Under'] },
  { id: 'MATCHES_DIFFERS', label: 'Matches / Differs', sides: ['MATCHES', 'DIFFERS'], labels: ['Matches', 'Differs'] },
  { id: 'EVEN_ODD', label: 'Even / Odd', sides: ['EVEN', 'ODD'], labels: ['Even', 'Odd'] },
];
const WIN_DIGIT_HOLD_MS = 2500;
export const DEMO_WIN_RATE = 0.9;
export function probability(c: string, b: number) {
  if (c === 'EVEN' || c === 'ODD' || c === 'MATCHES' || c === 'DIFFERS' || c === 'OVER' || c === 'UNDER') {
    return DEMO_WIN_RATE;
  }
  return 0;
}
const money = (n: number) => formatUsd(n);

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
  const [running, setRunning] = useState<RunningTrade | null>(null);
  const [lastResult, setLastResult] = useState<null | { account: AccountKind; won: boolean; profit: number; digit: number }>(null);
  const [winHold, setWinHold] = useState<null | { digit: number; up: boolean }>(null);
  const [targetProfit, setTargetProfit] = useState(String(DEFAULT_TARGET_PROFIT));
  const [stopLoss, setStopLoss] = useState(String(DEFAULT_STOP_LOSS));
  const [autoOn, setAutoOn] = useState(false);
  const [scannerOn, setScannerOn] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanFrame, setScanFrame] = useState<ScanChoice | null>(null);
  const [scanPrediction, setScanPrediction] = useState<ScanChoice | null>(null);
  const [loadedScan, setLoadedScan] = useState<LoadedScan | null>(null);
  const [scannedSide, setScannedSide] = useState<string | null>(null);
  const [sessionProfit, setSessionProfit] = useState(0);
  const [sessionNotice, setSessionNotice] = useState<null | { kind: 'target' | 'stop'; profit: number }>(null);
  const [stopNonce, setStopNonce] = useState(0);

  const marketRef = useRef(market);
  marketRef.current = market;
  const runningRef = useRef<RunningTrade | null>(running);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const placingRef = useRef(false);
  const autoRef = useRef(false);
  const stopRef = useRef(false);
  const scanOpenRef = useRef(false);
  const scanGenRef = useRef(0);
  const scanTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loadedScanRef = useRef<LoadedScan | null>(null);
  const scannedSideRef = useRef<string | null>(null);
  const barrierRef = useRef(barrier);
  barrierRef.current = barrier;
  const groupRef = useRef(group);
  groupRef.current = group;
  const settleRef = useRef<(() => void) | null>(null);
  const tickUpRef = useRef(true);
  const winHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const account = useQuery({ queryKey: ['practice-balance', user?.id], queryFn: async () => { const { data, error } = await supabase.rpc('get_practice_account'); if (error) throw error; return Number(data); } });
  const [accountType, setAccountType] = useState<AccountKind>('demo');
  const isReal = accountType === 'real';
  const realFunds = useQuery({ queryKey: ['real-balance', user?.id], enabled: !!user && isReal, retry: false, queryFn: () => loadAvailableRealBalance(user!.id) });
  const ticketLocked = !!running || autoOn;

  function signalSettled() {
    const resolve = settleRef.current;
    settleRef.current = null;
    resolve?.();
  }

  function waitUntilSettled(): Promise<void> {
    return new Promise((resolve) => {
      settleRef.current = resolve;
    });
  }

  // Demo outcomes are settled by the simulator, independent of the displayed ticks.
  useEffect(() => {
    if (!running) return;
    const finish = () => {
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
      if (running.won) {
        if (winHoldTimerRef.current) clearTimeout(winHoldTimerRef.current);
        setWinHold({ digit: running.digit, up: tickUpRef.current });
        winHoldTimerRef.current = setTimeout(() => {
          winHoldTimerRef.current = null;
          setWinHold(null);
        }, WIN_DIGIT_HOLD_MS);
      }
      runningRef.current = null;
      setRunning(null);
      signalSettled();
    };
    if (stopRef.current) {
      finish();
      return;
    }
    const id = setTimeout(() => {
      if (running.left > 1 && !stopRef.current) {
        const next = { ...running, left: running.left - 1 };
        runningRef.current = next;
        setRunning(next);
        return;
      }
      finish();
    }, 1000);
    return () => clearTimeout(id);
  }, [running, stopNonce, qc, user?.id]);

  useEffect(() => () => {
    if (winHoldTimerRef.current) clearTimeout(winHoldTimerRef.current);
    for (const timer of scanTimersRef.current) clearTimeout(timer);
  }, []);

  const livePrice = ticks[ticks.length - 1] ?? 0;
  const prev = ticks[ticks.length - 2] ?? livePrice;
  tickUpRef.current = livePrice >= prev;
  const liveDigit = ticks.length ? lastDigitOfQuote(livePrice, feed.decimals) : 0;
  const cursorDigit = heldCursorDigit(winHold?.digit ?? null, liveDigit);
  const price = winHold ? quoteWithLastDigit(livePrice, feed.decimals, cursorDigit) : livePrice;
  const markerDigit = winHold ? cursorDigit : liveDigit;
  const digit = markerDigit;
  const markerUp = winHold ? winHold.up : livePrice >= prev;
  const showMarker = winHold != null || ticks.length > 0;
  const chartTicks = useMemo(() => {
    if (!winHold || feed.ticks.length === 0) return feed.ticks;
    const next = feed.ticks.slice();
    const last = next[next.length - 1];
    if (!last) return feed.ticks;
    next[next.length - 1] = { ...last, quote: quoteWithLastDigit(last.quote, feed.decimals, heldCursorDigit(winHold.digit, lastDigitOfQuote(last.quote, feed.decimals))) };
    return next;
  }, [feed.ticks, feed.decimals, winHold]);
  const stats = ticks.slice(-100).reduce((counts, tick) => { counts[lastDigitOfQuote(tick, feed.decimals)] += 1; return counts; }, Array(10).fill(0) as number[]).map(n => (ticks.length ? (n / Math.min(ticks.length, 100)) * 100 : 0));
  const g = GROUPS.find(x => x.id === group) ?? GROUPS[0];
  const stakeNum = Number(stake);
  const validStake = stakeNum >= 0.35 && stakeNum <= 5000;
  const evenOddEntry = group === 'EVEN_ODD' && loadedScan != null && (loadedScan.contract === 'EVEN' || loadedScan.contract === 'ODD');
  const barrierOptions = group === 'EVEN_ODD' && !evenOddEntry ? [] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  async function buy(contract: string, options?: { forceWin?: boolean; marketId?: string; stake?: number; accountIsReal?: boolean }): Promise<Settlement | null> {
    if (scanOpenRef.current) return null;
    if (runningRef.current || placingRef.current) return null;
    const stakeValue = options?.stake ?? stakeNum;
    const real = options?.accountIsReal ?? isReal;
    const marketId = options?.marketId ?? marketRef.current.id;
    const forceWin = options?.forceWin === true;
    const prediction = barrierRef.current;
    if (stakeValue < 0.35 || stakeValue > 5000) { toast.error('Stake must be between 0.35 and 5,000 USD'); return null; }
    if (contract === 'OVER' && prediction > 8) { toast.error('Over needs a prediction from 0 to 8'); return null; }
    if (contract === 'UNDER' && prediction < 1) { toast.error('Under needs a prediction from 1 to 9'); return null; }
    const available = real ? realFunds.data : account.data;
    if (real && available == null) { toast.error('Real balance is still loading.'); return null; }
    if (available != null && stakeValue > available) {
      toast.error(real ? 'Stake is more than your available real balance.' : 'Stake is more than your practice balance.');
      return null;
    }
    const settlementAccount: AccountKind = real ? 'real' : 'demo';
    placingRef.current = true;
    try {
      const { data, error } = await supabase.rpc(isReal ? 'place_real_trade' : 'place_practice_trade', {
        _market: marketId,
        _contract: contract,
        _barrier: groupRef.current === 'EVEN_ODD' ? 0 : prediction,
        _stake: stakeValue,
        ...(forceWin ? { _force_win: true } : {}),
      });
      if (error) { toast.error(error.message); return null; }
      const r = data as Settlement | null;
      if (!r || typeof r.exit_digit !== 'number') { toast.error('Trade could not be settled.'); return null; }
      const profit = Number(r.profit);
      const balance = Number(r.balance);
      if (settlementAccount === 'real') qc.setQueryData(['real-balance', user?.id], (b: number | undefined) => (b ?? 0) - stakeValue);
      else qc.setQueryData(['practice-balance', user?.id], (b: number | undefined) => (b ?? 0) - stakeValue);
      const payload: RunningTrade = { account: settlementAccount, contract, left: durationRef.current, digit: r.exit_digit, won: r.won, profit, balance };
      runningRef.current = payload;
      setLastResult(null);
      setRunning(payload);
      return { exit_digit: r.exit_digit, won: r.won, profit, balance };
    } finally {
      placingRef.current = false;
    }
  }

  function selectMarket(next: Market) {
    marketRef.current = next;
    setMarket(next);
  }

  function clearScanTimers() {
    for (const timer of scanTimersRef.current) clearTimeout(timer);
    scanTimersRef.current = [];
  }

  function clearLoadedScan() {
    loadedScanRef.current = null;
    setLoadedScan(null);
    scannedSideRef.current = null;
    setScannedSide(null);
    if (!scanOpenRef.current) setScannerOn(false);
  }

  function closeScanner() {
    clearScanTimers();
    scanGenRef.current += 1;
    scanOpenRef.current = false;
    setScanOpen(false);
    setScanRunning(false);
    setScanPrediction(null);
    setScanFrame(null);
    if (!loadedScanRef.current) setScannerOn(false);
  }

  function openScanner() {
    if (runningRef.current || autoRef.current) return;
    clearScanTimers();
    const gen = ++scanGenRef.current;
    const sequence = buildScanSequence(MARKETS.length);
    scanOpenRef.current = true;
    setScanOpen(true);
    setScannerOn(true);
    setScanRunning(true);
    setScanPrediction(null);
    setScanFrame(sequence[0] ?? null);
    sequence.forEach((frame, index) => {
      const timer = setTimeout(() => {
        if (scanGenRef.current !== gen) return;
        setScanFrame(frame);
        if (index === sequence.length - 1) {
          setScanPrediction(frame);
          setScanRunning(false);
        }
      }, index * SCAN_FRAME_MS);
      scanTimersRef.current.push(timer);
    });
  }

  function loadPrediction() {
    const choice = scanPrediction;
    if (!choice) return;
    const nextMarket = MARKETS[choice.marketIndex];
    const nextGroup = scanContractGroup(choice.contract);
    if (!nextMarket || !nextGroup) return;
    clearScanTimers();
    scanGenRef.current += 1;
    selectMarket(nextMarket);
    groupRef.current = nextGroup;
    setGroup(nextGroup);
    barrierRef.current = choice.entry;
    setBarrier(choice.entry);
    const loaded: LoadedScan = { marketId: nextMarket.id, contract: choice.contract, entry: choice.entry };
    loadedScanRef.current = loaded;
    setLoadedScan(loaded);
    scannedSideRef.current = choice.contract;
    setScannedSide(choice.contract);
    setScannerOn(true);
    scanOpenRef.current = false;
    setScanOpen(false);
    setScanRunning(false);
    setScanPrediction(null);
    setScanFrame(null);
  }

  function requestStop() {
    stopRef.current = true;
    setStopNonce((n) => n + 1);
  }

  async function startAuto(): Promise<void> {
    const loaded = loadedScanRef.current;
    if (autoRef.current || runningRef.current || placingRef.current || scanOpenRef.current || !loaded) return;
    const target = Number(targetProfit);
    const stop = Number(stopLoss);
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(stop) || stop <= 0) {
      toast.error('Enter a target profit and stop loss greater than 0.');
      return;
    }
    if (!validStake) { toast.error('Stake must be between 0.35 and 5,000 USD'); return; }
    const side = loaded.contract;
    const opening = isReal ? realFunds.data : account.data;
    if (opening == null) {
      toast.error(isReal ? 'Real balance is still loading.' : 'Demo balance is still loading.');
      return;
    }
    if (opening < stakeNum) {
      toast.error(isReal ? 'Stake is more than your available real balance.' : 'Stake is more than your practice balance.');
      return;
    }

    const accountIsReal = isReal;
    const stakeValue = stakeNum;
    autoRef.current = true;
    stopRef.current = false;
    setAutoOn(true);
    setSessionProfit(0);
    let session = 0;
    let balance = opening;
    try {
      while (autoRef.current && !stopRef.current) {
        if (autoTradeDecision({ sessionProfit: session, targetProfit: target, stopLoss: stop, balance, stake: stakeValue }) !== 'continue') break;
        const result = await buy(side, { forceWin: true, marketId: marketRef.current.id, stake: stakeValue, accountIsReal });
        if (!result) break;
        await waitUntilSettled();
        session = addSessionProfit(session, result.profit);
        balance = result.balance;
        setSessionProfit(session);
        const decision = autoTradeDecision({ sessionProfit: session, targetProfit: target, stopLoss: stop, balance, stake: stakeValue });
        if (decision === 'target' || decision === 'stop') {
          setSessionNotice({ kind: decision, profit: session });
          break;
        }
        if (stopRef.current) break;
        if (decision === 'insufficient') {
          toast.error('Auto trade stopped because the account cannot cover the next stake.');
          break;
        }
      }
    } finally {
      autoRef.current = false;
      stopRef.current = false;
      setAutoOn(false);
    }
  }

  async function reset(): Promise<void> {
    const { error } = await supabase.rpc('reset_practice_account');
    if (error) { toast.error(error.message); return; }
    qc.setQueryData(['practice-balance', user?.id], 10000); toast.success('Practice balance reset to 10,000.00 USD');
  }

  const notice = sessionNotice ? sessionNoticeCopy(sessionNotice.kind, sessionNotice.profit) : null;
  if (!g) return null;
  return <div className="trade-shell"><SiteHeader /><main className="trade-page">
    <div className="trade-topbar">
      <select className="trade-select" value={market.id} onChange={e => { const next = MARKETS.find(m => m.id === e.target.value); if (!next || ticketLocked || scanOpen) return; selectMarket(next); clearLoadedScan(); }} disabled={ticketLocked || scanOpen} aria-label="Market">{MARKETS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <div className="trade-balance"><Button asChild size="sm" className="trade-deposit-btn"><Link to="/dashboard"><ArrowDownToLine /> Deposit</Link></Button><Button asChild size="sm" variant="outline" className="trade-deposit-btn"><Link to="/dashboard"><ArrowUpFromLine /> Withdraw</Link></Button><div className="account-switcher" role="tablist" aria-label="Account type"><button role="tab" aria-selected={!isReal} className={!isReal ? 'selected' : ''} onClick={() => setAccountType('demo')} disabled={ticketLocked}>Demo</button><button role="tab" aria-selected={isReal} className={isReal ? 'selected' : ''} onClick={() => setAccountType('real')} disabled={ticketLocked}><img src="/usa-flag.svg" alt="" /> Real</button></div><span className="demo-badge">{isReal ? 'Real' : 'Demo'}</span><strong>{isReal ? (realFunds.data != null ? money(realFunds.data) : realFunds.isError ? '—' : '…') : account.data != null ? money(account.data) : '…'} USD</strong>{!isReal && <Button variant="ghost" size="icon" onClick={reset} aria-label="Reset practice balance" disabled={ticketLocked}><RotateCcw /></Button>}</div>
    </div>
    <div className="trade-layout">
      <section className="trade-chart-card">
        <div className="live-market-heading"><div><h1>{market.name}</h1></div><span className={`feed-status ${feed.status}`} role="status"><i />{feed.status === 'live' ? 'Live' : feed.status === 'connecting' ? 'Connecting' : 'Disconnected'}</span></div>
        <div className="live-market-price"><strong className={livePrice >= prev ? 'up' : 'down'}>{ticks.length ? price.toFixed(feed.decimals) : '—'}</strong><span className={livePrice >= prev ? 'up' : 'down'}>{ticks.length > 1 ? `${livePrice >= prev ? '+' : ''}${(livePrice - prev).toFixed(feed.decimals)}` : '—'}</span><small>{feed.updated ? new Date(feed.updated * 1000).toISOString().slice(11, 19) + ' UTC' : 'Awaiting prices'}</small></div>
        {feed.error && <div className="feed-error" role="alert">{feed.error}<Button variant="outline" size="sm" onClick={feed.reconnect}>Reconnect</Button></div>}
        <MarketChart ticks={chartTicks} decimals={feed.decimals} symbol={market.id} />
        <div className="digit-stats-heading"><h2>Last digit distribution</h2><span>{Math.min(ticks.length, 100)} market ticks · Last digit {ticks.length ? digit : '—'}</span></div>
        <div className="digit-row" aria-label="Last digit statistics">{stats.map((s, d) => <div key={d} className="digit-cell" aria-current={showMarker && d === markerDigit ? 'true' : undefined}><span className="digit-face"><span className="digit-num">{d}</span>{showMarker && d === markerDigit && <span className={`digit-marker ${markerUp ? 'up' : 'down'}${winHold ? ' is-held' : ''}`} aria-hidden="true"><span className="digit-marker-circle" /><span className="digit-marker-cursor" /></span>}{winHold && d === markerDigit && <span className="digit-won">Won</span>}</span><small>{s.toFixed(1)}%</small></div>)}</div>
        {running && <div className="trade-status">{running.account === 'real' ? 'Real' : 'Demo'} contract running: {running.contract.toLowerCase()} — {running.left} tick{running.left === 1 ? '' : 's'} left</div>}
        {lastResult && !running && <div className={`trade-status ${lastResult.won ? 'won' : 'lost'}`}>{lastResult.won ? `You won ${money(lastResult.profit)} USD` : `You lost ${money(-lastResult.profit)} USD`} — {lastResult.account === 'real' ? 'real' : 'demo'} exit digit {lastResult.digit}</div>}
      </section>
      <aside className="trade-panel">
        <div className="ticket-heading"><label className="ticket-contract"><span>Contract</span><select aria-label="Contract type" value={group} onChange={e => { const next = e.target.value as Group; groupRef.current = next; setGroup(next); if (loadedScanRef.current && scanContractGroup(loadedScanRef.current.contract) !== next) clearLoadedScan(); }} disabled={ticketLocked || scanOpen}>{GROUPS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label><Button asChild variant="ghost" size="sm"><Link to="/positions"><History /> Positions</Link></Button></div>
        {barrierOptions.length > 0 && <div className="prediction-control"><span className="trade-label">Digit</span><div className="tick-picker" aria-label="Last digit prediction">{barrierOptions.map(n => <Button variant="ghost" key={n} aria-label={`Predict digit ${n}`} aria-pressed={n === barrier} className={n === barrier ? 'active' : ''} onClick={() => { barrierRef.current = n; setBarrier(n); if (loadedScanRef.current && loadedScanRef.current.entry !== n) clearLoadedScan(); }} disabled={ticketLocked || scanOpen}>{n}</Button>)}</div></div>}
        <div className="ticket-fields"><label className="ticket-field" htmlFor="duration"><span>Duration (seconds)</span><select id="duration" value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={ticketLocked}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} second{n === 1 ? '' : 's'}</option>)}</select></label><label className="ticket-field" htmlFor="stake"><span>Stake (USD)</span><input id="stake" type="number" min={0.35} max={5000} step={0.01} value={stake} onChange={e => setStake(e.target.value)} disabled={ticketLocked} /></label></div>
        <div className="ticket-fields ticket-auto"><label className="ticket-field" htmlFor="target-profit"><span>Target profit</span><input id="target-profit" aria-label="Target profit" type="number" min={0.01} step={0.01} value={targetProfit} onChange={e => setTargetProfit(e.target.value)} disabled={ticketLocked} /></label><label className="ticket-field" htmlFor="stop-loss"><span>Stop loss</span><input id="stop-loss" aria-label="Stop loss" type="number" min={0.01} step={0.01} value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={ticketLocked} /></label></div>
        <div className="ticket-auto-actions"><Button type="button" variant="outline" className="ticket-scanner" aria-pressed={scannerOn} aria-busy={scanRunning} onClick={openScanner} disabled={ticketLocked}><ScanSearch /> AI scanner</Button>{autoOn ? <Button type="button" variant="destructive" onClick={requestStop}>Stop</Button> : <Button type="button" onClick={() => void startAuto()} disabled={!!running || scanOpen || !loadedScan} title={loadedScan ? undefined : 'Load a prediction before auto trade'}>Auto trade</Button>}</div>
        {scanOpen && scanFrame && <div className="ticket-scan-prompt" role="dialog" aria-label="AI scanner" data-phase={scanPrediction ? 'prediction' : 'scanning'}><div className="ticket-scan-prompt-head"><strong>{scanPrediction ? 'Prediction' : 'Scanning'}</strong><Button type="button" variant="ghost" size="icon" onClick={closeScanner} aria-label="Close scanner"><X /></Button></div><p className="ticket-scan-label">Volatility</p><div className="ticket-scan-chips" aria-label="Volatility markets">{MARKETS.map((item, index) => <span key={item.id} data-active={scanFrame.marketIndex === index ? 'true' : 'false'}>{item.id.replace('R_', '')}</span>)}</div><p className="ticket-scan-label">Contract</p><div className="ticket-scan-chips" aria-label="Contracts">{SCAN_CONTRACTS.map((contract) => <span key={contract} data-active={scanFrame.contract === contract ? 'true' : 'false'}>{scanContractLabel(contract)}</span>)}</div><p className="ticket-scan-label">Entry</p><div className="ticket-scan-chips" aria-label="Entries">{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((entry) => <span key={entry} data-active={scanFrame.entry === entry ? 'true' : 'false'}>{entry}</span>)}</div><p className="ticket-scan-readout" aria-hidden="true">{MARKETS[scanFrame.marketIndex]?.name} · {scanContractLabel(scanFrame.contract)} · Entry {scanFrame.entry}</p>{scanPrediction ? <p className="ticket-scan-prediction" role="status">{MARKETS[scanPrediction.marketIndex]?.name} · {scanContractLabel(scanPrediction.contract)} · Entry {scanPrediction.entry}</p> : <p className="ticket-scan-status" role="status" data-phase="scanning"><LoaderCircle className="animate-spin" aria-hidden="true" />Scanning markets</p>}{scanPrediction && <Button type="button" onClick={loadPrediction}>Load prediction</Button>}</div>}
        {loadedScan && !scanOpen && <p className="ticket-scan-loaded" role="status" data-loaded-market={loadedScan.marketId} data-loaded-contract={loadedScan.contract} data-loaded-entry={loadedScan.entry}>Prediction loaded: {MARKETS.find((item) => item.id === loadedScan.marketId)?.name} · {scanContractLabel(loadedScan.contract)} · Entry {loadedScan.entry}. Click Auto trade to start.</p>}
        <div className="ticket-buy-actions">{g.sides.map((c, i) => { const realBlocked = isReal && (realFunds.data == null || stakeNum > realFunds.data); const scanPurchase = loadedScanMatches(loadedScan, { marketId: market.id, contract: c, entry: barrier }); const disabled = realBlocked || ticketLocked || scanOpen || !validStake || (c === 'OVER' && barrier > 8) || (c === 'UNDER' && barrier < 1); const payout = validStake ? quotedPayout(stakeNum) : 0; const entryLabel = group === 'EVEN_ODD' ? (scanPurchase ? ` ${barrier}` : '') : ` ${barrier}`; return <Button key={c} className={`buy-btn ${i === 0 ? 'buy-up' : 'buy-down'}${!scanOpen && scannedSide === c ? ' scanner-side' : ''}`} onClick={() => void buy(c, { forceWin: scanPurchase })} disabled={disabled}>{i === 0 ? <TrendingUp /> : <TrendingDown />}<span><strong>{g.labels[i]}{entryLabel}</strong><small>Payout {money(payout)} USD</small></span></Button>; })}</div>
        {isReal && realFunds.isError && <p className="ticket-disclaimer" role="alert">Real balance could not be loaded.</p>}
        {isReal && realFunds.data != null && validStake && stakeNum > realFunds.data && <p className="ticket-disclaimer" role="status">Stake is more than your available real balance.</p>}
        {autoOn && <p className="ticket-disclaimer" role="status">Session profit {money(sessionProfit)} USD</p>}
        {running && <p className="ticket-disclaimer" role="status">{`${running.contract.replace('_', ' ')} · ${running.left}s remaining`}</p>}
      </aside>
    </div>
    <Dialog open={notice != null} onOpenChange={(open) => { if (!open) setSessionNotice(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice?.title}</DialogTitle>
          <DialogDescription>{notice?.description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  </main></div>;
}
