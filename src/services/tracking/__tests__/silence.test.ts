import { describe, it, expect } from 'vitest';
import { findSilentTrackers } from '../silence';

const HOUR = 3600_000;
const checkin = new Date('2026-08-12T08:00:00Z');

describe('findSilentTrackers', () => {
  it('flags a vehicle checked in with no fix anywhere near it', () => {
    const out = findSilentTrackers(
      [{ vehicleId: 'a', registration: 'HW50KNGP', checkInAt: checkin, nearestFixMs: 40 * HOUR }],
      6 * HOUR
    );
    expect(out.map((s) => s.registration)).toEqual(['HW50KNGP']);
  });

  it('does not flag a vehicle whose tracker reported near the check-in', () => {
    expect(findSilentTrackers(
      [{ vehicleId: 'b', registration: 'LG94NLGP', checkInAt: checkin, nearestFixMs: 1 * HOUR }],
      6 * HOUR
    )).toEqual([]);
  });

  it('does not assess a vehicle with no fixes AND no check-in evidence', () => {
    // nearestFixMs null means we have no anchor. Silence must mean "not
    // assessed", never "healthy" and never "dead".
    expect(findSilentTrackers(
      [{ vehicleId: 'c', registration: 'CR69KTZN', checkInAt: checkin, nearestFixMs: null }],
      6 * HOUR
    )).toEqual([]);
  });

  it('is silent exactly at the window, and fires just past it', () => {
    // Boundary check: `nearestFixMs > windowMs`, not `>=`. A fix exactly at
    // the calibrated window is not yet evidence of a dead tracker.
    expect(findSilentTrackers(
      [{ vehicleId: 'd', registration: 'BOUND01GP', checkInAt: checkin, nearestFixMs: 6 * HOUR }],
      6 * HOUR
    )).toEqual([]);
    expect(findSilentTrackers(
      [{ vehicleId: 'e', registration: 'BOUND02GP', checkInAt: checkin, nearestFixMs: 6 * HOUR + 1 }],
      6 * HOUR
    ).map((s) => s.registration)).toEqual(['BOUND02GP']);
  });

  it('assesses each row independently across a mixed fleet', () => {
    const out = findSilentTrackers(
      [
        { vehicleId: 'a', registration: 'SILENT1GP', checkInAt: checkin, nearestFixMs: 40 * HOUR },
        { vehicleId: 'b', registration: 'HEALTHY1GP', checkInAt: checkin, nearestFixMs: 1 * HOUR },
        { vehicleId: 'c', registration: 'NOFIX1GP', checkInAt: checkin, nearestFixMs: null },
        { vehicleId: 'd', registration: 'SILENT2GP', checkInAt: checkin, nearestFixMs: 100 * HOUR },
      ],
      6 * HOUR
    );
    expect(out.map((s) => s.registration)).toEqual(['SILENT1GP', 'SILENT2GP']);
  });
});
