/**
 * Tests for describeCurrentOneMapState — the live 1Map re-check that builds the
 * factual resolution-note delta when an OLT investigate row is resolved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/modules/system/services/oneMapApiService', () => ({
  oneMapApi: { searchDR: vi.fn(), searchBySerial: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { describeCurrentOneMapState } from '../oltSerialReverseLookup';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';

const searchDR = vi.mocked(oneMapApi.searchDR);
const searchBySerial = vi.mocked(oneMapApi.searchBySerial);

const rec = (over: Record<string, unknown> = {}) =>
  ({ prop_id: 'p', drp: 'DR1', ph_ont: null, br_ser: null, status: null, ...over } as never);

describe('describeCurrentOneMapState', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns "match"/changed when the DR is now on 1Map with the OES serial', async () => {
    searchDR.mockResolvedValue({ success: true, records: [rec({ drp: 'DR1', ph_ont: 'ALCLB48E205C' })] });
    const r = await describeCurrentOneMapState('DR1', 'alclb48e205c');
    expect(r.state).toBe('match');
    expect(r.changed).toBe(true);
    expect(r.summary).toContain('now on 1Map');
    expect(searchBySerial).not.toHaveBeenCalled();
  });

  it('returns "mismatch" when the DR is on 1Map but with a different ONT', async () => {
    searchDR.mockResolvedValue({ success: true, records: [rec({ drp: 'DR1', ph_ont: 'OTHER123' })] });
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('mismatch');
    expect(r.changed).toBe(false);
    expect(r.summary).toContain('OTHER123');
  });

  it('returns "absent_serial_elsewhere" when DR is gone but the serial sits on another DR', async () => {
    searchDR.mockResolvedValue({ success: true, records: [] });
    searchBySerial.mockResolvedValue({ success: true, records: [rec({ drp: 'DR999', ph_ont: 'ALCLB48E205C', status: 'Active' })] });
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('absent_serial_elsewhere');
    expect(r.changed).toBe(false);
    expect(r.summary).toContain('DR999');
    expect(r.summary).toContain('Active');
  });

  it('ignores a "no drop allocated" placeholder and the same DR when locating the serial', async () => {
    searchDR.mockResolvedValue({ success: true, records: [] });
    searchBySerial.mockResolvedValue({
      success: true,
      records: [rec({ drp: 'no drop allocated', ph_ont: 'ALCLB48E205C' }), rec({ drp: 'DR1', ph_ont: 'ALCLB48E205C' })],
    });
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('absent_serial_missing');
  });

  it('returns "absent_serial_missing" when DR is gone and the serial is nowhere', async () => {
    searchDR.mockResolvedValue({ success: true, records: [] });
    searchBySerial.mockResolvedValue({ success: true, records: [] });
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('absent_serial_missing');
  });

  it('returns "unknown" (no API call) when the record has no OES serial', async () => {
    const r = await describeCurrentOneMapState('DR1', null);
    expect(r.state).toBe('unknown');
    expect(searchDR).not.toHaveBeenCalled();
  });

  it('returns "unknown" — never throws — when the 1Map lookup fails', async () => {
    searchDR.mockResolvedValue({ success: false, records: [], error: 'rate limited' });
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('unknown');
    expect(r.summary).toContain('unavailable');
  });

  it('returns "unknown" when searchDR throws', async () => {
    searchDR.mockRejectedValue(new Error('network'));
    const r = await describeCurrentOneMapState('DR1', 'ALCLB48E205C');
    expect(r.state).toBe('unknown');
    expect(r.changed).toBe(false);
  });
});
