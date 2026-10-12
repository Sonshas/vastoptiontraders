import { describe, expect, it } from 'vitest';
import { buildMegaPayStkRequest, depositUsdFromKes, minimumDepositMessage, normalizeMegaPayPhoneNumber, resolveMegaPayKesPerUsd } from '@/lib/megapay';

describe('MegaPay STK request', () => {
  it('normalizes Kenyan phone numbers for MegaPay', () => {
    expect(normalizeMegaPayPhoneNumber('+254 712 345 678')).toBe('254712345678');
    expect(normalizeMegaPayPhoneNumber('0712 345 678')).toBe('254712345678');
  });

  it('sends the entered shilling amount and credits the USD equivalent', () => {
    const request = buildMegaPayStkRequest({
      amountKes: 2000,
      kesPerUsd: 129,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    });

    expect(request).toEqual({
      api_key: 'test-key',
      email: 'merchant@example.com',
      amount: 2000,
      msisdn: '254712345678',
      reference: 'deposit-123',
    });
    expect(depositUsdFromKes(2000, 129)).toBe(15.5);
    expect(depositUsdFromKes(1600, 129)).toBe(12.4);
  });

  it('accepts the KES 1600 minimum and rejects anything below it', () => {
    const request = {
      amountKes: 1599,
      kesPerUsd: 129,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    };

    expect(minimumDepositMessage()).toBe('Minimum deposit is KES 1,600.');
    expect(() => buildMegaPayStkRequest(request)).toThrow('Minimum deposit is KES 1,600.');
    expect(buildMegaPayStkRequest({ ...request, amountKes: 1600 }).amount).toBe(1600);
    expect(buildMegaPayStkRequest({ ...request, amountKes: 5000 }).amount).toBe(5000);
    expect(() => buildMegaPayStkRequest({ ...request, amountKes: 5000, kesPerUsd: 0 })).toThrow('Set a valid VITE_MEGAPAY_KES_PER_USD exchange rate.');
  });

  it('prefers the baked exchange rate and falls back to the runtime value', () => {
    expect(resolveMegaPayKesPerUsd('129', undefined)).toBe(129);
    expect(resolveMegaPayKesPerUsd(undefined, '129')).toBe(129);
    expect(resolveMegaPayKesPerUsd('', '130')).toBe(130);
    expect(resolveMegaPayKesPerUsd('', '')).toBe(0);
  });
});
