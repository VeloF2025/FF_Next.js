/**
 * Guards the DB→verification wiring that this PR adds: the step-6 photo serials
 * (vlm_ont_serial_step6 / vlm_ups_serial_step6) and the drops mini_ups_serial must
 * be SELECTed under the right aliases AND assembled into the correct ONT vs UPS
 * slot. calculateVerification is tested separately as a pure function; this covers
 * computeSerialVerification — both the SQL aliases (a swapped `as step6_ont` would
 * otherwise stay green) and the JS array assembly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// neon() returns a tagged-template query fn. Capture the SQL text so we can assert
// the aliases, and return a row we control so we can assert the slot assembly.
const mockNeon: { row: Record<string, unknown>; sql: string } = { row: {}, sql: '' };
vi.mock('@/lib/db-neon', () => ({
  neon: () => (strings: TemplateStringsArray, ..._vals: unknown[]) => {
    mockNeon.sql = strings.join(' ? ').replace(/\s+/g, ' ');
    return Promise.resolve([mockNeon.row]);
  },
  neonConfig: {},
}));

import { computeSerialVerification } from '../serialVerificationService';

describe('computeSerialVerification — step-6 / drops row wiring', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test';
    mockNeon.row = {};
    mockNeon.sql = '';
  });

  it('SELECTs the step-6 / drops columns under the aliases the aggregator reads', async () => {
    mockNeon.row = { onemap_ont: 'X' };
    await computeSerialVerification('DR123');
    // CTE maps the raw columns to step6_ont/step6_ups; a swapped column here feeds
    // the wrong serial into the aggregator with every pure-function test still green.
    expect(mockNeon.sql).toMatch(/vlm_ont_serial_step6 as step6_ont/);
    expect(mockNeon.sql).toMatch(/vlm_ups_serial_step6 as step6_ups/);
    expect(mockNeon.sql).toMatch(/mini_ups_serial as ups/);
    // Outer select-outs — a swapped source (e.g. step6_ups pulled into the step6_ont
    // slot) is the exact mutation a row-only mock cannot see, so assert them too.
    expect(mockNeon.sql).toMatch(/\(SELECT step6_ont FROM onemap_data\) as step6_ont/);
    expect(mockNeon.sql).toMatch(/\(SELECT step6_ups FROM onemap_data\) as step6_ups/);
    expect(mockNeon.sql).toMatch(/\(SELECT ups FROM drops_data\) as drops_ups/);
  });

  it('routes step6_ont to the ONT array and step6_ups + drops_ups to the UPS array', async () => {
    mockNeon.row = {
      oes_ont: null, offline_ont: null,
      onemap_ont: 'ALCLB48D0001', onemap_ups: null,
      step6_ont: 'ALCLB48D0001', // agrees with onemap ONT → 2 ONT sources
      step6_ups: 'GU18W12V1112223334', // → UPS source
      drops_ups: 'GU18W12V1112223334', // → UPS source
      ph_bl_dr: null, ph_bl_ont: null, row_oes_serial: null,
      wa_ont: null, wa_ups: null, wa_confidence: null,
    };

    const res = await computeSerialVerification('DR123');

    // Without step6_ont in the ONT array this is 1 source / 'insufficient'; a UPS
    // value assembled into the ONT slot makes the two ONT sources disagree
    // (status ≠ 'partial'). Either mutation fails here.
    expect(res.ontVerification.sourcesWithData).toBe(2);
    expect(res.ontVerification.status).toBe('partial');

    // step6_ups + drops_ups are the only two UPS sources; dropping or mis-assigning
    // either drops this to 1.
    expect(res.upsVerification.sourcesWithData).toBe(2);
    expect(res.upsVerification.status).toBe('partial');
  });
});
