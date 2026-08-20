/**
 * Tests for parseScanPayload — classifies a decoded barcode payload.
 *
 * Fixtures are the real decoded strings from a Nokia G-0126G-A carton
 * (see docs/superpowers/specs/2026-08-20-ont-box-scanning-design.md).
 */
import { describe, it, expect } from 'vitest';
import { parseScanPayload } from '../boxScan';

const BOX =
  'ALCLB49486FF;ALCLB4948758;ALCLB4948779;ALCLB49488FC;ALCLB4949054;' +
  'ALCLB4949388;ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C';

const PACKAGE_DATA =
  '[)>\x1e06\x1d1P3TN01414BA\x1d18VLENOK\x1d2P01\x1d1VOM02\x1dQ9\x1d4LCN\x1d3SM022540C0126A10210\x1e\x04';

const SINGLE_DATAMATRIX = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4923FA8\x1e\x04';

describe('parseScanPayload', () => {
  it('reads all nine serials from the carton box code', () => {
    const result = parseScanPayload(BOX);
    expect(result.kind).toBe('box');
    expect(result.kind === 'box' && result.serials).toEqual([
      'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
      'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
    ]);
  });

  it('reads part number, quantity and package id from the ISO data code', () => {
    const result = parseScanPayload(PACKAGE_DATA);
    expect(result).toEqual({
      kind: 'package-data',
      partNumber: '3TN01414BA',
      quantity: 9,
      packageId: 'M022540C0126A10210',
    });
  });

  it('still reads a single serial from the unit DataMatrix envelope', () => {
    expect(parseScanPayload(SINGLE_DATAMATRIX)).toEqual({
      kind: 'single',
      serial: 'ALCLB4923FA8',
    });
  });

  it('reads a bare 1D serial unchanged', () => {
    expect(parseScanPayload('  alclb4949f3c ')).toEqual({
      kind: 'single',
      serial: 'ALCLB4949F3C',
    });
  });

  it('strips the ISO column S prefix only for a Nokia-shaped serial', () => {
    expect(parseScanPayload('SALCLB49486FF')).toEqual({ kind: 'single', serial: 'ALCLB49486FF' });
    // Not Nokia-shaped: the S is part of the serial, never stripped.
    expect(parseScanPayload('S1234567890')).toEqual({ kind: 'single', serial: 'S1234567890' });
  });

  it('upper-cases and de-duplicates box members, preserving first-seen order', () => {
    const result = parseScanPayload('alclb4948758;ALCLB49486FF;ALCLB4948758');
    expect(result.kind === 'box' && result.serials).toEqual(['ALCLB4948758', 'ALCLB49486FF']);
  });

  it('drops malformed members but keeps the box when two or more survive', () => {
    const result = parseScanPayload('ALCLB49486FF;;xx;ALCLB4948758');
    expect(result.kind === 'box' && result.serials).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('falls back to single when only one member survives', () => {
    expect(parseScanPayload('ALCLB49486FF;xx')).toEqual({ kind: 'single', serial: 'ALCLB49486FF' });
  });

  it('returns unrecognised for empty and junk input rather than guessing', () => {
    expect(parseScanPayload('')).toEqual({ kind: 'unrecognised', raw: '' });
    expect(parseScanPayload('   ')).toEqual({ kind: 'unrecognised', raw: '' });
    expect(parseScanPayload('hello world')).toEqual({ kind: 'unrecognised', raw: 'hello world' });
  });

  it('returns every member of an oversized box — the cap is enforced by callers', () => {
    const many = Array.from({ length: 60 }, (_, i) => `ALCLB4948${String(i).padStart(4, '0')}`);
    const result = parseScanPayload(many.join(';'));
    expect(result.kind === 'box' && result.serials).toHaveLength(60);
  });
});
