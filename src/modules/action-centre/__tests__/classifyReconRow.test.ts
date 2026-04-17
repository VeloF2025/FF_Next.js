/**
 * Unit tests for classifyReconRow — pure function, 5 buckets.
 * Locks down the semantics of the Recon tab's dispute classification.
 */

import { describe, it, expect } from 'vitest';
import { classifyReconRow } from '../classifyReconRow';

describe('classifyReconRow', () => {
  it('returns no_oes when OES has no serial for the drop', () => {
    expect(
      classifyReconRow({
        oesSerial: null,
        ftSerial: 'ALCLB48E9A65',
        lastFixSerial: null,
        lastFixAt: null,
        oltRejected: false,
      }),
    ).toBe('no_oes');
  });

  it('returns no_oes even when a prior fix existed (OES is the source of truth)', () => {
    expect(
      classifyReconRow({
        oesSerial: null,
        ftSerial: 'ALCLB48E9A65',
        lastFixSerial: 'ALCLB48E9A65',
        lastFixAt: '2026-04-15T10:00:00Z',
        oltRejected: false,
      }),
    ).toBe('no_oes');
  });

  it('returns already_fixed_still_billed when our prior fix matches OES', () => {
    expect(
      classifyReconRow({
        oesSerial: 'ALCLB48E9A65',
        ftSerial: 'ALCLB48E9A42',
        lastFixSerial: 'ALCLB48E9A65',
        lastFixAt: '2026-04-15T10:00:00Z',
        oltRejected: false,
      }),
    ).toBe('already_fixed_still_billed');
  });

  it('matches fix vs OES case-insensitively', () => {
    expect(
      classifyReconRow({
        oesSerial: 'alclb48e9a65',
        ftSerial: 'ALCLB48E9A42',
        lastFixSerial: 'ALCLB48E9A65',
        lastFixAt: '2026-04-15T10:00:00Z',
        oltRejected: false,
      }),
    ).toBe('already_fixed_still_billed');
  });

  it('falls through to blocked_no_installed when fix exists but does not match OES + OLT rejected', () => {
    expect(
      classifyReconRow({
        oesSerial: 'ALCLB48E9A65',
        ftSerial: 'ALCLB48E9A42',
        lastFixSerial: 'ALCLB48E9A99', // stale / wrong fix
        lastFixAt: '2026-04-15T10:00:00Z',
        oltRejected: true,
      }),
    ).toBe('blocked_no_installed');
  });

  it('returns blocked_no_installed when no prior fix and OLT is rejected', () => {
    expect(
      classifyReconRow({
        oesSerial: 'ALCLB48E9A65',
        ftSerial: null,
        lastFixSerial: null,
        lastFixAt: null,
        oltRejected: true,
      }),
    ).toBe('blocked_no_installed');
  });

  it('returns actionable when OES has a serial, no prior fix, no OLT rejection', () => {
    expect(
      classifyReconRow({
        oesSerial: 'ALCLB48E9A65',
        ftSerial: 'ALCLB48E9A42',
        lastFixSerial: null,
        lastFixAt: null,
        oltRejected: false,
      }),
    ).toBe('actionable');
  });

  it('returns actionable when a fix serial is stored but lastFixAt is null (not a real fix)', () => {
    expect(
      classifyReconRow({
        oesSerial: 'ALCLB48E9A65',
        ftSerial: 'ALCLB48E9A42',
        lastFixSerial: 'ALCLB48E9A65',
        lastFixAt: null,
        oltRejected: false,
      }),
    ).toBe('actionable');
  });
});
