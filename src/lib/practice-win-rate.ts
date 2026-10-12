export const PRACTICE_WIN_RATE_KEY = 'practice_win_rate';
export const REAL_WIN_RATE_KEY = 'real_win_rate';
export const DEFAULT_PRACTICE_WIN_RATE = 90;
export const DEFAULT_REAL_WIN_RATE = 90;

export type WinRateKind = 'demo' | 'real';

const STORED_RATE = /^[0-9]+(\.[0-9]+)?$/;
const ENTERED_RATE = /^-?[0-9]+(\.[0-9]+)?$/;

/** Rate used by settlement. Unset or invalid stored values fall back to 90. */
export function settlementWinRate(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) return DEFAULT_PRACTICE_WIN_RATE;
    return value;
  }
  if (value == null) return DEFAULT_PRACTICE_WIN_RATE;
  const text = String(value).trim();
  if (!STORED_RATE.test(text)) return DEFAULT_PRACTICE_WIN_RATE;
  const rate = Number(text);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return DEFAULT_PRACTICE_WIN_RATE;
  return rate;
}

/** True when a roll in [0, 1] wins at the given percentage. 100 always wins and 0 always loses. */
export function settlementRollWins(roll: number, winRatePercent: unknown): boolean {
  const rate = settlementWinRate(winRatePercent);
  if (rate >= 100) return true;
  if (rate <= 0) return false;
  return roll < rate / 100;
}

export function digitSatisfiesContract(contract: string, barrier: number, digit: number): boolean {
  switch (contract) {
    case 'EVEN': return digit % 2 === 0;
    case 'ODD': return digit % 2 === 1;
    case 'MATCHES': return digit === barrier;
    case 'DIFFERS': return digit !== barrier;
    case 'OVER': return digit > barrier;
    case 'UNDER': return digit < barrier;
    default: return false;
  }
}

/** Digits 0–9 whose contract result equals the decided outcome. */
export function digitsMatchingOutcome(contract: string, barrier: number, won: boolean): number[] {
  const digits: number[] = [];
  for (let digit = 0; digit < 10; digit++) {
    if (digitSatisfiesContract(contract, barrier, digit) === won) digits.push(digit);
  }
  return digits;
}

/** True when a roll in [0, 1) is a demo win at the given percentage. */
export function practiceTradeWins(roll: number, winRatePercent: unknown): boolean {
  return settlementRollWins(roll, winRatePercent);
}

export type WinRateInput =
  | { ok: true; value: number; clamped: boolean }
  | { ok: false; message: string };

export function winRateValidationMessage(kind: WinRateKind = 'demo'): string {
  return kind === 'real' ? 'Enter a real win rate from 0 to 100.' : 'Enter a demo win rate from 0 to 100.';
}

/** Accept an admin entry, clamping out-of-range numbers to 0–100. */
export function parseWinRateInput(raw: string, kind: WinRateKind = 'demo'): WinRateInput {
  const message = winRateValidationMessage(kind);
  const text = raw.trim();
  if (!ENTERED_RATE.test(text)) {
    return { ok: false, message };
  }
  const entered = Number(text);
  if (!Number.isFinite(entered)) {
    return { ok: false, message };
  }
  const value = Math.min(100, Math.max(0, entered));
  return { ok: true, value, clamped: value !== entered };
}
