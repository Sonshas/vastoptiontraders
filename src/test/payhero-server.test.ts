import { describe, expect, it } from 'vitest';

import {
  buildPayHeroMpesaRequest,
  isPayHeroConfigured,
  resolvePayHeroEndpoint,
} from '@/lib/payhero';

describe('PayHero helpers', () => {
  it('builds a valid M-Pesa payload with normalized phone number', () => {
    const payload = buildPayHeroMpesaRequest({
      amount: 2500,
      phoneNumber: '+254 712 345 678',
      reference: 'deposit-123',
      channelId: '5376',
    });

    expect(payload.amount).toBe(2500);
    expect(payload.phone_number).toBe('254712345678');
    expect(payload.reference).toBe('deposit-123');
    expect(payload.channel_id).toBe('5376');
  });

  it('detects when live PayHero configuration is present', () => {
    const previous = process.env.PAYHERO_API_USERNAME;
    process.env.PAYHERO_API_USERNAME = 'demo-user';
    process.env.PAYHERO_API_PASSWORD = 'demo-pass';
    process.env.PAYHERO_ACCOUNT_ID = 'ac-123';
    process.env.PAYHERO_CHANNEL_ID = '5376';

    try {
      expect(isPayHeroConfigured()).toBe(true);
      expect(resolvePayHeroEndpoint()).toContain('api');
    } finally {
      if (previous === undefined) delete process.env.PAYHERO_API_USERNAME;
      else process.env.PAYHERO_API_USERNAME = previous;
    }
  });
});
