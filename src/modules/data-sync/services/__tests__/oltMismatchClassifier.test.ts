/**
 * Unit tests for the shared OLT mismatch classifier — one assertion set per
 * classification branch. These are pure functions (no DB / 1Map I/O), so the
 * tests carry no mocks. They lock the verdict shapes that both queue-processing
 * paths (the inline endpoint processor and the continuation service) now share,
 * so the two can never drift again.
 */

import { describe, it, expect } from 'vitest';
import type { OneMapRecord } from '@/modules/system/services/oneMapApiService';
import {
  INSTALLED_STATUS,
  classifyEmptyRecords,
  classifyOltRecords,
  buildCrossDrContext,
  type RecordClassification,
} from '../oltMismatchClassifier';

const rec = (over: Partial<OneMapRecord> = {}): OneMapRecord =>
  ({ prop_id: 'p1', drp: 'DR1', ph_ont: null, br_ser: null, status: null, ...over });

describe('classifyEmptyRecords', () => {
  it('classifies not_found when the serial is nowhere else on 1Map', () => {
    const r = classifyEmptyRecords(null);
    expect(r).toEqual({
      mismatchType: 'note2_not_on_1map',
      fixStatus: 'not_found',
      investigationContext: null,
    });
  });

  it('classifies serial_other_dr and carries the reverse-lookup context', () => {
    const context = JSON.stringify({ reason: 'serial_on_other_dr', foundOnDr: 'DR999' });
    const r = classifyEmptyRecords({ context });
    expect(r).toEqual({
      mismatchType: 'note2_serial_other_dr',
      fixStatus: 'serial_other_dr',
      investigationContext: context,
    });
  });
});

describe('classifyOltRecords', () => {
  it('match: correct serial WITH installed status → pending, no context', () => {
    const cls = classifyOltRecords('alclb48e205c', [
      rec({ ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS }),
    ]);
    expect(cls.mismatchType).toBe('match');
    expect(cls.fixStatus).toBe('pending');
    expect(cls.investigationContext).toBeNull();
    expect(cls.correctCount).toBe(1);
  });

  it('match is upheld when ANY correct-serial prop carries the installed status', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [
      rec({ prop_id: 'p1', ph_ont: 'ALCLB48E205C', status: 'Home Sign Ups: Approved & Installation Scheduled' }),
      rec({ prop_id: 'p2', ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS }),
    ]);
    expect(cls.mismatchType).toBe('match');
    expect(cls.investigationContext).toBeNull();
  });

  it('status_mismatch: correct serial but NO prop installed → needs_investigation + exact context shape', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [
      rec({ prop_id: '536406', ph_ont: 'ALCLB48E205C', status: 'Home Sign Ups: Approved & Installation Scheduled' }),
    ]);
    expect(cls.mismatchType).toBe('status_mismatch');
    expect(cls.fixStatus).toBe('needs_investigation');
    expect(cls.wrongOneMapSerial).toBeNull();
    expect(JSON.parse(cls.investigationContext!)).toEqual({
      reason: 'status_mismatch',
      propId: '536406',
      currentStatus: 'Home Sign Ups: Approved & Installation Scheduled',
      expectedStatus: INSTALLED_STATUS,
      message:
        'No prop record with correct serial has "Home Installation: Installed" status. Best match: "Home Sign Ups: Approved & Installation Scheduled"',
    });
  });

  it('status_mismatch falls back to "unknown" when the prop status is null', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [
      rec({ prop_id: '999', ph_ont: 'ALCLB48E205C', status: null }),
    ]);
    expect(cls.mismatchType).toBe('status_mismatch');
    const ctx = JSON.parse(cls.investigationContext!);
    expect(ctx.currentStatus).toBe('unknown');
    expect(ctx.message).toContain('Best match: "unknown"');
  });

  it('note4_wrong_serial: a different ONT → wrongOneMapSerial is the wrong serial', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [
      rec({ ph_ont: 'OTHER12345', br_ser: null, status: INSTALLED_STATUS }),
    ]);
    expect(cls.mismatchType).toBe('note4_wrong_serial');
    expect(cls.fixStatus).toBe('pending');
    expect(cls.hasUpsSwap).toBe(false);
    expect(cls.firstWrongSerial).toBe('OTHER12345');
    expect(cls.wrongOneMapSerial).toBe('OTHER12345');
  });

  it('note4_ups_swap: OES serial sits in the UPS field with a GU18 ONT → hasUpsSwap', () => {
    const cls = classifyOltRecords('GU18W12V25116435', [
      rec({ ph_ont: 'GU18AABBCCDD', br_ser: 'GU18W12V25116435', status: INSTALLED_STATUS }),
    ]);
    expect(cls.mismatchType).toBe('note4_ups_swap');
    expect(cls.hasUpsSwap).toBe(true);
    expect(cls.swapCount).toBe(1);
    expect(cls.firstWrongSerial).toBe('GU18AABBCCDD');
  });

  it('note4_empty_barcode: empty ONT with no correct record → empty_barcode', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [rec({ ph_ont: null, status: INSTALLED_STATUS })]);
    expect(cls.mismatchType).toBe('note4_empty_barcode');
    expect(cls.emptyCount).toBe(1);
    expect(cls.correctCount).toBe(0);
  });

  it('swap takes priority over a wrong record in the same DR', () => {
    const cls = classifyOltRecords('GU18W12V25116435', [
      rec({ prop_id: 'p1', ph_ont: 'OTHER12345' }),
      rec({ prop_id: 'p2', ph_ont: 'GU18AABBCCDD', br_ser: 'GU18W12V25116435' }),
    ]);
    expect(cls.mismatchType).toBe('note4_ups_swap');
    expect(cls.wrongCount).toBe(1);
    expect(cls.swapCount).toBe(1);
  });

  it('bestRecord prefers the first record that has an ONT serial', () => {
    const cls = classifyOltRecords('ALCLB48E205C', [
      rec({ prop_id: 'empty', ph_ont: null }),
      rec({ prop_id: 'hasont', ph_ont: 'OTHER12345' }),
    ]);
    expect(cls.bestRecord.prop_id).toBe('hasont');
  });
});

describe('buildCrossDrContext', () => {
  const wrongCls: RecordClassification = {
    mismatchType: 'note4_wrong_serial',
    fixStatus: 'pending',
    hasUpsSwap: false,
    wrongOneMapSerial: 'ALCLB47D5463',
    investigationContext: null,
    bestRecord: rec({ ph_ont: 'ALCLB47D5463' }),
    firstWrongSerial: 'ALCLB47D5463',
    firstUpsSerial: 'GU18W12V25116435',
    correctCount: 1,
    emptyCount: 0,
    wrongCount: 1,
    swapCount: 0,
    totalPropRecords: 2,
  };

  it('cross_dr_conflict when the wrong serial belongs to a different drop', () => {
    const r = buildCrossDrContext(
      wrongCls,
      { drop_number: 'DR1730560', serial_number: 'ALCLB47D5463', team: 'law7', status: 'Active' },
      'DR1730579',
    );
    expect(r).not.toBeNull();
    expect(r!.fixStatus).toBe('needs_investigation');
    expect(JSON.parse(r!.investigationContext)).toEqual({
      reason: 'cross_dr_conflict',
      wrongSerial: 'ALCLB47D5463',
      wrongUps: 'GU18W12V25116435',
      belongsToDr: 'DR1730560',
      belongsToTeam: 'law7',
      belongsToStatus: 'Active',
      totalPropRecords: 2,
      correctRecords: 1,
      wrongRecords: 1,
      swappedRecords: 0,
      message:
        'ONT ALCLB47D5463 on 1Map belongs to DR1730560 (law7). Cannot auto-fix without losing equipment tracking.',
    });
  });

  it('no override (null) when the owner is unknown', () => {
    expect(buildCrossDrContext(wrongCls, null, 'DR1730579')).toBeNull();
  });

  it('no override (null) when the serial belongs to the SAME drop', () => {
    expect(
      buildCrossDrContext(
        wrongCls,
        { drop_number: 'DR1730579', serial_number: 'ALCLB47D5463', team: 'law7', status: 'Active' },
        'DR1730579',
      ),
    ).toBeNull();
  });
});
