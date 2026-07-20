/**
 * Unit tests for the reconciliation confirmation predicate — the single
 * decision that lets the daily sweep auto-resolve an open mismatch record.
 * Pure function, no mocks. Locks the deliberate difference from
 * `classifyOltRecords`: a stale wrong serial on another prop must NOT block
 * resolution once an installed prop carries the OES serial.
 */

import { describe, it, expect } from 'vitest';
import type { OneMapRecord } from '@/modules/system/services/oneMapApiService';
import { INSTALLED_STATUS } from '../oltMismatchClassifier';
import { hasConfirmedInstalledMatch } from '../oltMatchReconciliationService';

const rec = (over: Partial<OneMapRecord> = {}): OneMapRecord =>
  ({ prop_id: 'p1', drp: 'DR1', ph_ont: null, br_ser: null, status: null, ...over });

describe('hasConfirmedInstalledMatch', () => {
  it('true when the OES serial sits on an installed prop', () => {
    const records = [rec({ ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(true);
  });

  it('normalises case and whitespace on both sides', () => {
    const records = [rec({ ph_ont: '  alclb48e205c ', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, ' Alclb48E205c ')).toBe(true);
  });

  it('false when the serial matches but no prop is installed yet', () => {
    const records = [
      rec({ ph_ont: 'ALCLB48E205C', status: 'Home Sign Ups: Approved & Installation Scheduled' }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('false when only a different serial is installed', () => {
    const records = [rec({ ph_ont: 'ALCLB4900000', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('false when the correct serial is on one prop but installed status is on another', () => {
    const records = [
      rec({ ph_ont: 'ALCLB48E205C', status: 'Home Installation: In Progress' }),
      rec({ prop_id: 'p2', ph_ont: 'ALCLB4900000', status: INSTALLED_STATUS }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('true even when another prop still carries a stale wrong serial', () => {
    const records = [
      rec({ ph_ont: 'ALCLB4900000', status: 'Home Sign Ups: Approved' }),
      rec({ prop_id: 'p2', ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(true);
  });

  it('false on empty records or empty serial', () => {
    expect(hasConfirmedInstalledMatch([], 'ALCLB48E205C')).toBe(false);
    expect(
      hasConfirmedInstalledMatch([rec({ ph_ont: 'X', status: INSTALLED_STATUS })], '  '),
    ).toBe(false);
  });
});
