import { describe, expect, it } from 'vitest';
import { buildMegaPayStkRequest, normalizeMegaPayPhoneNumber } from '@/lib/megapay';

describe('MegaPay STK request', () => {
  it('normalizes Kenyan phone numbers for MegaPay', () => {
    expect(normalizeMegaPayPhoneNumber('+254 712 345 678')).toBe('254712345678');
    expect(normalizeMegaPayPhoneNumber('0712 345 678')).toBe('254712345678');
  });

  it('converts the USD deposit to whole KES using the configured fixed rate', () => {
    const request = buildMegaPayStkRequest({
      amountUsd: 10.01,
      kesPerUsd: 130,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    });

    expect(request).toEqual({
      api_key: 'test-key',
      email: 'merchant@example.com',
      amount: 1301,
      msisdn: '254712345678',
      reference: 'deposit-123',
    });
  });

  it('rejects deposits below the USD minimum and invalid exchange rates', () => {
    const request = {
      amountUsd: 9.99,
      kesPerUsd: 130,
      phoneNumber: '0712345678',
      reference: 'deposit-123',
      apiKey: 'test-key',
      email: 'merchant@example.com',
    };

    expect(() => buildMegaPayStkRequest(request)).toThrow('Minimum deposit is 10.00 USD.');
    expect(() => buildMegaPayStkRequest({ ...request, amountUsd: 10, kesPerUsd: 0 })).toThrow('Set a valid VITE_MEGAPAY_KES_PER_USD exchange rate.');
  });
});