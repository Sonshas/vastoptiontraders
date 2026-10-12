import { describe, expect, it } from 'vitest';
import { buildMegaPayStkRequest, minimumDepositMessage, minimumDepositUsd, normalizeMegaPayPhoneNumber, resolveMegaPayKesPerUsd } from '@/lib/megapay';

describe('MegaPay STK request', () => {
  it('normalizes Kenyan phone numbers for MegaPay', () => {
    expect(normalizeMegaPayPhoneNumber('+254 712 345 678')).toBe('254712345678');
    expect(normalizeMegaPayPhoneNumber('0712 345 678')).toBe('254712345678');
  });

  it('converts the USD deposit to whole KES using the configured fixed rate', () => {
    const request = buildMegaPayStkRequest({
      amountUsd: 12.4,
      kesPerUsd: 129,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    });

    expect(request).toEqual({
      api_key: 'test-key',
      email: 'merchant@example.com',
      amount: 1600,
      msisdn: '254712345678',
      reference: 'deposit-123',
    });
  });

  it('rejects deposits below KES 1600 and invalid exchange rates', () => {
    const request = {
      amountUsd: 12.39,
      kesPerUsd: 129,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    };

    expect(minimumDepositUsd(129)).toBe(12.4);
    expect(minimumDepositMessage(129)).toBe('Minimum deposit is KES 1,600 (12.40 USD).');
    expect(() => buildMegaPayStkRequest(request)).toThrow('Minimum deposit is KES 1,600 (12.40 USD).');
    expect(() => buildMegaPayStkRequest({ ...request, amountUsd: 10, kesPerUsd: 129 })).toThrow('Minimum deposit is KES 1,600 (12.40 USD).');
    expect(() => buildMegaPayStkRequest({ ...request, amountUsd: 20, kesPerUsd: 0 })).toThrow('Set a valid VITE_MEGAPAY_KES_PER_USD exchange rate.');
  });

  it('prefers the baked exchange rate and falls back to the runtime value', () => {
    expect(resolveMegaPayKesPerUsd('129', undefined)).toBe(129);
    expect(resolveMegaPayKesPerUsd(undefined, '129')).toBe(129);
    expect(resolveMegaPayKesPerUsd('', '130')).toBe(130);
    expect(resolveMegaPayKesPerUsd('', '')).toBe(0);
  });
});