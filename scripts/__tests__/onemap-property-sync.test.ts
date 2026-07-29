import { describe, expect, it, vi } from 'vitest';

import {
  normalizeOneMapContact,
  upsertProperties,
} from '../lib/onemap-property-sync.mjs';

function oneMapRecord(overrides: Record<string, unknown> = {}) {
  return {
    prop_id: '101',
    drp: 'DR101',
    ph_ont: null,
    br_ser: null,
    status: 'Home Installation: Installed',
    site: 'ETW',
    pole: 'ETW.P.A1',
    address: '1 Main Road',
    latitude: '-26.1',
    longitude: '28.1',
    contnr: '078 118 0119',
    last_modified_signup_date: null,
    last_modified_install_date: null,
    last_modified_by: '1Map User',
    last_modified_date: '2026-07-29',
    ...overrides,
  };
}

describe('1Map property contact sync', () => {
  it('normalizes a phone-only contnr using the shared MSISDN rules', () => {
    expect(normalizeOneMapContact('078 118 0119')).toBe('27781180119');
    expect(normalizeOneMapContact('+27 (78) 118-0119')).toBe('27781180119');
  });

  it('fails closed instead of collapsing a free-form field to digits', () => {
    expect(normalizeOneMapContact('Hein 0781180119')).toBeNull();
    expect(normalizeOneMapContact('Plot 12 / 0781180119')).toBeNull();
    expect(normalizeOneMapContact('12345')).toBeNull();
  });

  it('persists normalized contnr in the recurring property upsert', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const count = await upsertProperties(
      { query },
      [
        oneMapRecord(),
        oneMapRecord({ prop_id: '102', drp: 'DR102', contnr: 'customer unavailable' }),
        oneMapRecord({ prop_id: null }),
      ],
      9,
    );

    expect(count).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/contact_number/);
    expect(sql).toMatch(/contact_number = EXCLUDED\.contact_number/);
    expect(params).toHaveLength(16);
    expect(params[9]).toBe('27781180119');

    const invalidParams = query.mock.calls[1]?.[1] as unknown[];
    expect(invalidParams).toHaveLength(16);
    expect(invalidParams[9]).toBeNull();
    expect(invalidParams).not.toContain('customer unavailable');
  });
});
