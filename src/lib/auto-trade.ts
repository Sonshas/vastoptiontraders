import { settlementRollWins } from '@/lib/practice-win-rate';

export const DEFAULT_TARGET_PROFIT = 50;
export const DEFAULT_STOP_LOSS = 25;

export type AutoTradeStop = 'continue' | 'target' | 'stop' | 'insufficient';

export type AutoTradeSnapshot = {
  sessionProfit: number;
  targetProfit: number;
  stopLoss: number;
  balance: number;
  stake: number;
};

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/** Session profit from settled trade results, in cents so 9 + 9 stays 18. */
export function addSessionProfit(sessionProfit: number, tradeProfit: number): number {
  return (cents(sessionProfit) + cents(tradeProfit)) / 100;
}

/**
 * Stop after a settled trade when the session reached its target or its loss
 * limit. A balance that cannot cover the next stake stops the loop without
 * counting as a stop-loss hit. Target and stop loss win over that balance check.
 */
export function autoTradeDecision(snapshot: AutoTradeSnapshot): AutoTradeStop {
  if (cents(snapshot.sessionProfit) >= cents(snapshot.targetProfit)) return 'target';
  if (cents(snapshot.sessionProfit) <= -cents(snapshot.stopLoss)) return 'stop';
  if (cents(snapshot.balance) < cents(snapshot.stake)) return 'insufficient';
  return 'continue';
}

/** Auto trade and AI scanner trades win even when the saved rate is not 100. Manual trades keep the rate. */
export function autoOrScannerTradeWins(forceWin: boolean, roll: number, winRatePercent: unknown): boolean {
  if (forceWin) return true;
  return settlementRollWins(roll, winRatePercent);
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function sessionNoticeCopy(kind: 'target' | 'stop', sessionProfit: number): { title: string; description: string } {
  const amount = formatUsd(sessionProfit);
  if (kind === 'stop') {
    return {
      title: 'Stop loss hit',
      description: `Stop loss was hit. Session profit ${amount} USD.`,
    };
  }
  return {
    title: 'Target profit hit',
    description: `Target profit was hit. Session profit ${amount} USD.`,
  };
}

/** Pick one of the markets the ticket already offers. */
export function pickScannerMarket<T>(markets: readonly T[], random: () => number = Math.random): T {
  const index = Math.min(markets.length - 1, Math.floor(random() * markets.length));
  return markets[index]!;
}

/** First contract side the ticket can buy at this prediction. */
export function tradableSide(sides: readonly string[], barrier: number): string | null {
  for (const side of sides) {
    if (side === 'OVER' && barrier > 8) continue;
    if (side === 'UNDER' && barrier < 1) continue;
    return side;
  }
  return null;
}

/** How long each AI scanner step stays on the ticket before the next one. */
export const SCAN_STEP_MS = 1000;

export type ScannerPosition = { barrier: number; side: string };

/** Pick a contract side and a digit the ticket can buy for that side. */
export function pickScannerPosition(sides: readonly string[], random: () => number = Math.random): ScannerPosition | null {
  if (sides.length === 0) return null;
  const side = sides[Math.min(sides.length - 1, Math.floor(random() * sides.length))]!;
  let barrier = Math.min(9, Math.max(0, Math.floor(random() * 10)));
  if (side === 'OVER') barrier = Math.min(barrier, 8);
  if (side === 'UNDER') barrier = Math.max(barrier, 1);
  if (tradableSide([side], barrier) !== side) return null;
  return { barrier, side };
}

export const SCAN_CONTRACTS = ['MATCHES', 'DIFFERS', 'OVER', 'UNDER', 'EVEN', 'ODD'] as const;
export type ScanContract = (typeof SCAN_CONTRACTS)[number];

export type ScanChoice = {
  marketIndex: number;
  contract: ScanContract;
  entry: number;
};

export type LoadedScan = {
  marketId: string;
  contract: ScanContract;
  entry: number;
};

/** Prompt is shown on the click, before this bound. Frames then play inside it. */
export const SCAN_PROMPT_MAX_MS = 2000;
/** How long each random scan frame stays visible inside the prompt. */
export const SCAN_FRAME_MS = 300;

/** Digits or barriers that win for the contract. */
export function winningScanEntries(contract: string): readonly number[] {
  switch (contract) {
    case 'EVEN':
      return [0, 2, 4, 6, 8];
    case 'ODD':
      return [1, 3, 5, 7, 9];
    case 'OVER':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8];
    case 'UNDER':
      return [1, 2, 3, 4, 5, 6, 7, 8, 9];
    case 'MATCHES':
    case 'DIFFERS':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    default:
      return [];
  }
}

export function scanContractGroup(contract: string): 'OVER_UNDER' | 'MATCHES_DIFFERS' | 'EVEN_ODD' | null {
  if (contract === 'OVER' || contract === 'UNDER') return 'OVER_UNDER';
  if (contract === 'MATCHES' || contract === 'DIFFERS') return 'MATCHES_DIFFERS';
  if (contract === 'EVEN' || contract === 'ODD') return 'EVEN_ODD';
  return null;
}

export function scanContractLabel(contract: string): string {
  switch (contract) {
    case 'MATCHES':
      return 'Matches';
    case 'DIFFERS':
      return 'Differs';
    case 'OVER':
      return 'Over';
    case 'UNDER':
      return 'Under';
    case 'EVEN':
      return 'Even';
    case 'ODD':
      return 'Odd';
    default:
      return contract;
  }
}

/** True only when the ticket still holds the loaded scan, so a manual purchase can force a win. */
export function loadedScanMatches(
  loaded: LoadedScan | null,
  ticket: { marketId: string; contract: string; entry: number },
): boolean {
  if (!loaded) return false;
  return loaded.marketId === ticket.marketId && loaded.contract === ticket.contract && loaded.entry === ticket.entry;
}

function pickIndex(length: number, random: () => number): number {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1, random);
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy;
}

/** One random volatility, contract, and winning entry. */
export function pickScanChoice(marketCount: number, random: () => number = Math.random): ScanChoice {
  const count = Math.max(1, marketCount);
  const contract = SCAN_CONTRACTS[pickIndex(SCAN_CONTRACTS.length, random)]!;
  const entries = winningScanEntries(contract);
  return {
    marketIndex: pickIndex(count, random),
    contract,
    entry: entries[pickIndex(entries.length, random)] ?? 0,
  };
}

/**
 * A visible random pass across every contract and every listed volatility,
 * then one winning prediction. The last item is the prediction. The ticket
 * stays unchanged until the trader loads it.
 */
export function buildScanSequence(marketCount: number, random: () => number = Math.random): ScanChoice[] {
  const count = Math.max(1, marketCount);
  const contracts = shuffle(SCAN_CONTRACTS, random);
  const marketOrder = shuffle(Array.from({ length: count }, (_, index) => index), random);
  const steps = Math.max(contracts.length, marketOrder.length);
  const frames: ScanChoice[] = [];
  for (let i = 0; i < steps; i++) {
    const contract = contracts[i % contracts.length]!;
    const entries = winningScanEntries(contract);
    frames.push({
      marketIndex: marketOrder[i % marketOrder.length]!,
      contract,
      entry: entries[pickIndex(entries.length, random)] ?? 0,
    });
  }
  frames.push(pickScanChoice(count, random));
  return frames;
}
