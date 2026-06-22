/**
 * Unit tests for checkPowerMeterRange — the deterministic -18 to -24 dBm gate
 * applied to Step 7 (Power Meter) readings the VLM reads off the display.
 */
import { describe, it, expect } from 'vitest';
import {
  checkPowerMeterRange,
  POWER_METER_DBM_MAX,
  POWER_METER_DBM_MIN,
} from '../stepQualityCriteria';

describe('checkPowerMeterRange', () => {
  it('exposes the FibreFlow QA acceptance range (-18 to -24)', () => {
    expect(POWER_METER_DBM_MAX).toBe(-18);
    expect(POWER_METER_DBM_MIN).toBe(-24);
  });

  it('passes a reading inside the range', () => {
    expect(checkPowerMeterRange(true, -21).pass).toBe(true);
    expect(checkPowerMeterRange(true, -21.3).reason).toBeNull();
  });

  it('passes at both inclusive boundaries', () => {
    expect(checkPowerMeterRange(true, -18).pass).toBe(true);
    expect(checkPowerMeterRange(true, -24).pass).toBe(true);
  });

  it('fails when too weak (below -24)', () => {
    const r = checkPowerMeterRange(true, -25);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/Power levels are incorrect/);
    expect(r.reason).toMatch(/-25 dBm is outside the required -18 to -24/);
  });

  it('fails when too strong (above -18)', () => {
    const r = checkPowerMeterRange(true, -17.9);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/outside the required -18 to -24/);
  });

  it('fails when no numeric reading was extracted', () => {
    expect(checkPowerMeterRange(true, null).pass).toBe(false);
    expect(checkPowerMeterRange(true, null).reason).toMatch(/Could not read the dBm value/);
    expect(checkPowerMeterRange(true, NaN).pass).toBe(false);
  });

  it('keeps an existing VLM rejection (illegible) without a range reason', () => {
    const r = checkPowerMeterRange(false, null);
    expect(r.pass).toBe(false);
    expect(r.reason).toBeNull();
  });
});
