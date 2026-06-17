import { describe, it, expect } from 'vitest';
import { isCrossDrSwappable } from '../investigationContext';
import type { InvestigationContext } from '../../../../types';

describe('isCrossDrSwappable', () => {
  it('returns true for a genuine cross-DR conflict carrying both swap fields', () => {
    const ctx: InvestigationContext = {
      reason: 'cross_dr_conflict',
      message: 'ONT X on 1Map belongs to DR456',
      wrongSerial: 'ALCLB1234',
      belongsToDr: 'DR456',
      belongsToTeam: 'Team A',
    };
    expect(isCrossDrSwappable(ctx)).toBe(true);
  });

  it('returns false for a status_mismatch context (no swap fields) — would otherwise 400 the lookup', () => {
    const ctx: InvestigationContext = {
      reason: 'status_mismatch',
      message: 'No prop record with correct serial has "Installed" status.',
      propId: '123',
      currentStatus: 'Home Installation: In Progress',
    };
    expect(isCrossDrSwappable(ctx)).toBe(false);
  });

  it('returns false for a serial_on_other_dr context', () => {
    const ctx: InvestigationContext = {
      reason: 'serial_on_other_dr',
      message: 'Serial registered under a different DR',
      oesSerial: 'ALCLB9999',
      foundOnDr: 'DR789',
    };
    expect(isCrossDrSwappable(ctx)).toBe(false);
  });

  it('returns false for a cross_dr_conflict missing wrongSerial (malformed) — defensive', () => {
    const ctx: InvestigationContext = {
      reason: 'cross_dr_conflict',
      message: 'malformed',
      belongsToDr: 'DR456',
    };
    expect(isCrossDrSwappable(ctx)).toBe(false);
  });

  it('returns false for a cross_dr_conflict missing belongsToDr (malformed) — defensive', () => {
    const ctx: InvestigationContext = {
      reason: 'cross_dr_conflict',
      message: 'malformed',
      wrongSerial: 'ALCLB1234',
    };
    expect(isCrossDrSwappable(ctx)).toBe(false);
  });
});
