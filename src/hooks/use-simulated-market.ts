import { useEffect, useState } from 'react';

export type MarketTick = { epoch: number; quote: number };
type FeedState = { symbol: string; ticks: MarketTick[]; decimals: number; status: 'connecting' | 'live' | 'offline'; error: string; updated: number | null };

// In-house simulated price feed: a fair random walk generated locally, one tick per second.
export function useSimulatedMarket(symbol: string, precision: number, start: number, volatility: number) {
  const [state, setState] = useState<FeedState>({ symbol, ticks: [], decimals: precision, status: 'connecting', error: '', updated: null });
  useEffect(() => {
    const step = start * volatility * 0.002;
    const now = Math.floor(Date.now() / 1000);
    let price = start;
    const history: MarketTick[] = [];
    for (let i = 600; i > 0; i--) {
      price = Math.max(step, price + (Math.random() - 0.5) * 2 * step);
      history.push({ epoch: now - i, quote: Number(price.toFixed(precision)) });
    }
    setState({ symbol, ticks: history, decimals: precision, status: 'live', error: '', updated: history.at(-1)?.epoch ?? null });
    const id = setInterval(() => {
      price = Math.max(step, price + (Math.random() - 0.5) * 2 * step);
      const tick: MarketTick = { epoch: Math.floor(Date.now() / 1000), quote: Number(price.toFixed(precision)) };
      setState(prev => ({ symbol, ticks: [...prev.ticks.filter(t => t.epoch < tick.epoch), tick].slice(-1800), decimals: precision, status: 'live', error: '', updated: tick.epoch }));
    }, 1000);
    return () => clearInterval(id);
  }, [symbol, precision, start, volatility]);
  const current = state.symbol === symbol ? state : { symbol, ticks: [], decimals: precision, status: 'connecting' as const, error: '', updated: null };
  return { ...current, reconnect: () => undefined };
}
