import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  digitSatisfiesContract,
  digitsMatchingOutcome,
  heldCursorDigit,
  lastDigitOfQuote,
  quoteWithLastDigit,
} from '@/lib/practice-win-rate';

const root = dirname(fileURLToPath(import.meta.url));
const tradeSource = readFileSync(join(root, '../routes/_authenticated/trade.tsx'), 'utf8');

const CONTRACTS: { contract: string; barrier: number }[] = [
  { contract: 'EVEN', barrier: 0 },
  { contract: 'ODD', barrier: 0 },
  { contract: 'MATCHES', barrier: 4 },
  { contract: 'DIFFERS', barrier: 4 },
  { contract: 'OVER', barrier: 5 },
  { contract: 'UNDER', barrier: 5 },
];

const MARKET_DECIMALS = [2, 3, 4];

describe('settlement cursor digit', () => {
  it('picks a win digit that satisfies each contract and a loss digit that does not', () => {
    expect(digitsMatchingOutcome('EVEN', 0, true)).toEqual([0, 2, 4, 6, 8]);
    expect(digitsMatchingOutcome('EVEN', 0, false)).toEqual([1, 3, 5, 7, 9]);
    expect(digitsMatchingOutcome('ODD', 0, true)).toEqual([1, 3, 5, 7, 9]);
    expect(digitsMatchingOutcome('ODD', 0, false)).toEqual([0, 2, 4, 6, 8]);
    expect(digitsMatchingOutcome('MATCHES', 4, true)).toEqual([4]);
    expect(digitsMatchingOutcome('MATCHES', 4, false)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
    expect(digitsMatchingOutcome('DIFFERS', 4, false)).toEqual([4]);
    expect(digitsMatchingOutcome('OVER', 5, true).every((digit) => digit > 5)).toBe(true);
    expect(digitsMatchingOutcome('UNDER', 5, true).every((digit) => digit < 5)).toBe(true);

    for (const barrier of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const won of [true, false]) {
        for (const contract of ['MATCHES', 'DIFFERS'] as const) {
          const digits = digitsMatchingOutcome(contract, barrier, won);
          expect(digits.length).toBeGreaterThan(0);
          for (const digit of digits) expect(digitSatisfiesContract(contract, barrier, digit)).toBe(won);
          for (let digit = 0; digit <= 9; digit++) {
            if (!digits.includes(digit)) expect(digitSatisfiesContract(contract, barrier, digit)).toBe(!won);
          }
        }
      }
      if (barrier <= 8) {
        for (const digit of digitsMatchingOutcome('OVER', barrier, true)) expect(digit).toBeGreaterThan(barrier);
        for (const digit of digitsMatchingOutcome('OVER', barrier, false)) expect(digit).toBeLessThanOrEqual(barrier);
      }
      if (barrier >= 1) {
        for (const digit of digitsMatchingOutcome('UNDER', barrier, true)) expect(digit).toBeLessThan(barrier);
        for (const digit of digitsMatchingOutcome('UNDER', barrier, false)) expect(digit).toBeGreaterThanOrEqual(barrier);
      }
    }
  });

  it('holds the cursor on the settlement digit when the live tick contradicts it', () => {
    for (const { contract, barrier } of CONTRACTS) {
      for (const won of [true, false]) {
        const digits = digitsMatchingOutcome(contract, barrier, won);
        const contradicting = digitsMatchingOutcome(contract, barrier, !won)[0] ?? 0;
        for (const exitDigit of digits) {
          expect(heldCursorDigit(exitDigit, contradicting)).toBe(exitDigit);
          expect(digitSatisfiesContract(contract, barrier, heldCursorDigit(exitDigit, contradicting))).toBe(won);
          for (const decimals of MARKET_DECIMALS) {
            const liveQuote = quoteWithLastDigit(2400.1234, decimals, contradicting);
            const shown = quoteWithLastDigit(liveQuote, decimals, exitDigit);
            expect(lastDigitOfQuote(shown, decimals)).toBe(exitDigit);
            expect(digitSatisfiesContract(contract, barrier, lastDigitOfQuote(shown, decimals))).toBe(won);
          }
        }
      }
    }
    expect(heldCursorDigit(null, 8)).toBe(8);
  });

  it('keeps a winning trade cursor on the settlement digit instead of the live tick', () => {
    expect(tradeSource).toContain('heldCursorDigit(winHold?.digit ?? null, liveDigit)');
    expect(tradeSource).toContain('quoteWithLastDigit(livePrice, feed.decimals, cursorDigit)');
    expect(tradeSource).toContain('const markerDigit = winHold ? cursorDigit : liveDigit');
    expect(tradeSource).toContain("setWinHold({ digit: running.digit, up: tickUpRef.current })");
    expect(tradeSource).toContain('digit-won');
  });
});
