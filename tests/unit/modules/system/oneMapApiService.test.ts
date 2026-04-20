/**
 * Tests: OneMap API Service — HII Guard
 *
 * Covers:
 * 1. hasHomeInstallationInstalled pure function (all branches)
 * 2. Low-level writer guard: updateOntSerial blocks write when records lack HII
 * 3. Low-level writer guard: updateOntAndUpsSerial blocks write when records lack HII
 * 4. Regression for blocker #1: DR A UPS clear must not fire when DR A lacks HII
 *
 * STATUS: WORKING
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hasHomeInstallationInstalled,
  oneMapApi,
} from '@/modules/system/services/oneMapApiService';
import type { OneMapRecord } from '@/modules/system/services/oneMapApiService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(status: string | null, overrides: Partial<OneMapRecord> = {}): OneMapRecord {
  return {
    prop_id: 'PROP001',
    drp: 'DR0001',
    ph_ont: null,
    br_ser: null,
    status,
    pole: null,
    address: null,
    site: null,
    latitude: null,
    longitude: null,
    last_modified_by: null,
    last_modified_date: null,
    contact_person_name: null,
    contact_person_surname: null,
    contact_number: null,
    email_address: null,
    language: null,
    survey_date: null,
    ...overrides,
  };
}

const HII_RECORD = makeRecord('Home Installation: Installed');
const SCHEDULED_RECORD = makeRecord('Home Sign Ups: Approved & Installation Scheduled');
const NULL_STATUS_RECORD = makeRecord(null);

// ---------------------------------------------------------------------------
// Section 1: hasHomeInstallationInstalled — pure function
// ---------------------------------------------------------------------------

describe('hasHomeInstallationInstalled', () => {
  it('returns true when a record has exact HII status', () => {
    expect(hasHomeInstallationInstalled([HII_RECORD])).toBe(true);
  });

  it('returns true when HII status uses different case', () => {
    expect(
      hasHomeInstallationInstalled([makeRecord('home installation: installed')])
    ).toBe(true);
  });

  it('returns true when HII status is mixed-case', () => {
    expect(
      hasHomeInstallationInstalled([makeRecord('HOME INSTALLATION: INSTALLED')])
    ).toBe(true);
  });

  it('returns false when no record has HII status', () => {
    expect(hasHomeInstallationInstalled([SCHEDULED_RECORD])).toBe(false);
  });

  it('returns false when record array is empty', () => {
    expect(hasHomeInstallationInstalled([])).toBe(false);
  });

  it('returns false when all statuses are null', () => {
    expect(hasHomeInstallationInstalled([NULL_STATUS_RECORD, NULL_STATUS_RECORD])).toBe(false);
  });

  it('returns true when at least one record has HII among non-HII records', () => {
    // Mixed: first lacks HII, second has HII — must return true
    expect(
      hasHomeInstallationInstalled([SCHEDULED_RECORD, HII_RECORD, NULL_STATUS_RECORD])
    ).toBe(true);
  });

  it('returns false when status is a prefix match but not the full phrase', () => {
    // "Home Installation" without ": Installed" should NOT match
    expect(
      hasHomeInstallationInstalled([makeRecord('Home Installation: Pending')])
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2 & 3: Low-level writer guard in updateOntSerial / updateOntAndUpsSerial
//
// We do NOT want the actual HTTP fetch to fire. The service module uses the
// native `fetch` global internally (via fetchWithTimeout). We mock it at the
// global level so any accidental call would fail loudly rather than going out.
// ---------------------------------------------------------------------------

describe('OneMapApiService low-level writer guards', () => {
  beforeEach(() => {
    // Replace global fetch with a spy that fails loudly — it must NOT be called
    // when the HII guard fires before auth/network.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch must not be called when HII guard blocks')));
  });

  describe('updateOntSerial', () => {
    it('returns NO_HII failure without making any HTTP call when records lack HII', async () => {
      const records = [SCHEDULED_RECORD, NULL_STATUS_RECORD];
      const result = await oneMapApi.updateOntSerial('PROP001', 'ABC123', records);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NO_HII');
      expect(result.error).toMatch(/Home Installation: Installed/i);
      // fetch spy must not have been called
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('proceeds to auth when records are provided and HII is present (fetch will fail with stub)', async () => {
      const records = [HII_RECORD];
      // Auth will fail (no real credentials) — but the guard itself must not block it.
      const result = await oneMapApi.updateOntSerial('PROP001', 'ABC123', records);
      // The guard passed — result will be an auth/network error, NOT NO_HII
      expect(result.errorCode).not.toBe('NO_HII');
    });

    it('skips HII check when records parameter is omitted (backward compat)', async () => {
      // Without records the guard is bypassed — auth will fail because fetch throws
      const result = await oneMapApi.updateOntSerial('PROP001', 'ABC123');
      expect(result.errorCode).not.toBe('NO_HII');
    });
  });

  describe('updateOntAndUpsSerial', () => {
    it('returns NO_HII failure without making any HTTP call when records lack HII', async () => {
      const records = [SCHEDULED_RECORD];
      const result = await oneMapApi.updateOntAndUpsSerial('PROP001', 'ABC123', 'GU18X001', records);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NO_HII');
      expect(result.error).toMatch(/Home Installation: Installed/i);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('returns NO_HII when records array is empty', async () => {
      const result = await oneMapApi.updateOntAndUpsSerial('PROP001', 'ABC123', null, []);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NO_HII');
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('proceeds past guard when at least one record has HII', async () => {
      const records = [SCHEDULED_RECORD, HII_RECORD];
      const result = await oneMapApi.updateOntAndUpsSerial('PROP001', 'ABC123', 'GU18X001', records);
      expect(result.errorCode).not.toBe('NO_HII');
    });
  });
});

// ---------------------------------------------------------------------------
// Section 4: Regression — blocker #1
//
// Simulate the "drBSetSuccess=true (already has matching UPS)" path with DR A
// lacking HII. The UPS clear on DR A must NOT fire; the result must contain an
// error describing the block.
//
// We test the guard logic directly through the service layer since the handler
// in swap-fix.ts calls oneMapApi.searchDR + hasHomeInstallationInstalled before
// reaching updateOntAndUpsSerial. We verify the guard returns NO_HII before
// any fetch is made.
// ---------------------------------------------------------------------------

describe('Regression: blocker #1 — DR A UPS clear blocked when DR A lacks HII', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch must not be called')));
  });

  it('updateOntAndUpsSerial with DR A records that lack HII returns NO_HII without HTTP call', async () => {
    // This simulates what swap-fix.ts now does: passes drASearchForUps.records
    // to updateOntAndUpsSerial. If DR A lacks HII, the write is blocked.
    const drARecords = [makeRecord('Home Sign Ups: Approved & Installation Scheduled', { prop_id: 'PROP_A' })];

    const result = await oneMapApi.updateOntAndUpsSerial(
      'PROP_A',
      'CORRECT_ONT',
      '', // clearing UPS
      drARecords
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('NO_HII');
    // The fetch spy must not have fired — proves no HTTP write was attempted
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
