import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConsentForMsisdn: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('@/modules/communications/whatsapp/consent/consentRepo', () => ({
  getConsentForMsisdn: mocks.getConsentForMsisdn,
}));

import { recordOneMapConsent } from '../consentService';

const input = {
  msisdn: '27821234567',
  drNumber: 'DR-100',
  consentEvidence: {
    source: 'onemap_home_signup' as const,
    grantedAt: new Date('2026-07-31T08:00:00.000Z'),
  },
};

describe('recordOneMapConsent', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([{ status: 'granted' }]);
    mocks.getConsentForMsisdn.mockReset().mockResolvedValue({
      status: 'granted',
      row: { status: 'granted' },
    });
  });

  it('writes the exact OneMap evidence source and timestamp with parameterized SQL', async () => {
    await expect(recordOneMapConsent(input)).resolves.toBe('granted');

    const [text, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('INSERT INTO wa_subscriber_consent');
    expect(text).toContain('ON CONFLICT (msisdn) DO UPDATE SET');
    expect(text).not.toContain(input.msisdn);
    expect(params).toEqual([
      input.msisdn,
      input.drNumber,
      'onemap_home_signup',
      input.consentEvidence.grantedAt,
    ]);
  });

  it('keeps an existing grant granted after readback', async () => {
    await expect(recordOneMapConsent(input)).resolves.toBe('granted');
    expect(mocks.getConsentForMsisdn).toHaveBeenCalledWith(input.msisdn);
  });

  it('returns withdrawn when the durable consent readback is withdrawn', async () => {
    mocks.query.mockResolvedValue([{ status: 'withdrawn' }]);
    mocks.getConsentForMsisdn.mockResolvedValue({
      status: 'withdrawn',
      row: { status: 'withdrawn' },
    });

    await expect(recordOneMapConsent(input)).resolves.toBe('withdrawn');

    const [text] = mocks.query.mock.calls[0] as [string];
    expect(text).toContain("WHEN wa_subscriber_consent.status <> 'granted'");
    expect(text).toContain('ELSE wa_subscriber_consent.updated_at END');
  });

  it('preserves stronger manual and FNO evidence sources', async () => {
    await recordOneMapConsent(input);

    const [text] = mocks.query.mock.calls[0] as [string];
    expect(text).toContain("wa_subscriber_consent.source IN ('fno_payload','ops_manual')");
  });

  it('fails closed without exposing the MSISDN when readback has no grant state', async () => {
    mocks.getConsentForMsisdn.mockResolvedValue({ status: 'none' });

    let message = '';
    try {
      await recordOneMapConsent(input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Velocity review consent could not be verified');
    expect(message).not.toContain(input.msisdn);
  });

  it('redacts database errors that contain the MSISDN', async () => {
    mocks.query.mockRejectedValue(new Error(`failing row contains ${input.msisdn}`));

    await expect(recordOneMapConsent(input)).rejects.toThrow(
      'Velocity review consent could not be verified',
    );
    await expect(recordOneMapConsent(input)).rejects.not.toThrow(input.msisdn);
  });
});
