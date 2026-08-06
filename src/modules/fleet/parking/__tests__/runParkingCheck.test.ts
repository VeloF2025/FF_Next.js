import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParkingCandidate } from '../types';

const loadParkingCheckCandidates = vi.fn();
const insertComplianceCheck = vi.fn();

vi.mock('../parkingQueries', () => ({
  loadParkingCheckCandidates: (...a: unknown[]) => loadParkingCheckCandidates(...a),
  insertComplianceCheck: (...a: unknown[]) => insertComplianceCheck(...a),
}));

import { runParkingCheck, sastDateString } from '../runParkingCheck';

const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

function candidate(over: Partial<ParkingCandidate> = {}): ParkingCandidate {
  return {
    vehicleId: 'veh-1',
    registration: 'MW67LFGP',
    hasTracker: true,
    location: { id: 'loc-1', lat: -26.1929, lon: 28.0305, radiusM: 200 },
    lastFix: { recordedAt: new Date(CHECK_AT.getTime() - 3600_000), lat: -26.1929, lon: 28.0305 },
    ...over,
  };
}

/** A fresh row for the day. */
const wroteNew = { inserted: true, previousResult: null };
/** An overwrite of a row that already said the same thing. */
const overwrote = (previousResult: string) => ({ inserted: false, previousResult });

beforeEach(() => {
  loadParkingCheckCandidates.mockReset();
  insertComplianceCheck.mockReset();
  insertComplianceCheck.mockResolvedValue(wroteNew);
});

describe('sastDateString', () => {
  it('returns the SAST calendar date, not the UTC one', () => {
    // 22:30 UTC on the 4th is 00:30 SAST on the 5th.
    expect(sastDateString(new Date('2026-08-04T22:30:00.000Z'))).toBe('2026-08-05');
  });

  it('returns the same date for a 20:00 SAST instant', () => {
    expect(sastDateString(CHECK_AT)).toBe('2026-08-04');
  });
});

describe('runParkingCheck', () => {
  it('writes one row per vehicle and counts results', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate(),
      candidate({ vehicleId: 'veh-2', location: null }),
      candidate({ vehicleId: 'veh-3', hasTracker: false }),
    ]);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.evaluated).toBe(3);
    expect(report.counts.compliant).toBe(1);
    expect(report.counts.no_address).toBe(1);
    expect(report.counts.not_verifiable).toBe(1);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(3);
  });

  it('passes the SAST check date through to every row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ checkDate: '2026-08-04', vehicleId: 'veh-1' })
    );
  });

  // The row has to name its vehicle even after that vehicle is hard-deleted
  // and the FK is nulled, so the registration travels with the evidence.
  it('snapshots the registration onto the row it writes', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate({ registration: 'MW67LFGP' })]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ registration: 'MW67LFGP' })
    );
  });

  // One malformed vehicle must not cost us the other 21 results.
  it('continues after a failed insert and counts the error', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate({ vehicleId: 'veh-1' }),
      candidate({ vehicleId: 'veh-2' }),
    ]);
    insertComplianceCheck
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(wroteNew);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.errors).toBe(1);
    expect(report.evaluated).toBe(2);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(2);
  });

  it('records one results entry per successfully-inserted vehicle', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate({ vehicleId: 'veh-1', registration: 'MW67LFGP' }),
      candidate({ vehicleId: 'veh-2', registration: 'MW68LFGP', location: null }),
    ]);
    insertComplianceCheck
      .mockResolvedValueOnce(wroteNew)
      .mockResolvedValueOnce(overwrote('no_address'));

    const report = await runParkingCheck(CHECK_AT);

    expect(report.results).toHaveLength(2);
    expect(report.results[0]).toEqual({
      vehicleId: 'veh-1',
      registration: 'MW67LFGP',
      result: 'compliant',
      distanceM: 0,
      lastFixAgeSeconds: 3600,
      inserted: true,
      previousResult: null,
      newViolation: false,
    });
    expect(report.results[1]).toEqual({
      vehicleId: 'veh-2',
      registration: 'MW68LFGP',
      result: 'no_address',
      distanceM: null,
      lastFixAgeSeconds: null,
      inserted: false,
      previousResult: 'no_address',
      newViolation: false,
    });
  });

  it('omits a vehicle from results when its insert throws, but still counts the error', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate({ vehicleId: 'veh-1', registration: 'MW67LFGP' }),
      candidate({ vehicleId: 'veh-2', registration: 'MW68LFGP' }),
    ]);
    insertComplianceCheck
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(wroteNew);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.errors).toBe(1);
    expect(report.results).toHaveLength(1);
    expect(report.results.map((r) => r.vehicleId)).toEqual(['veh-2']);
  });

  it('records the deciding fix as evidence on the row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFixAgeSeconds: 3600,
        distanceM: 0,
        parkingLocationId: 'loc-1',
        result: 'compliant',
      })
    );
  });

  // A row that says "no address on file" must not also link to the address it
  // was supposedly checked against — that contradiction is what a disputed
  // violation gets argued over.
  it('does not attribute a location to a no_address row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      // Out of range: the classifier refuses it, so it did not decide anything.
      candidate({ location: { id: 'loc-bad', lat: 200, lon: 28.0305, radiusM: 200 } }),
    ]);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.counts.no_address).toBe(1);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'no_address', parkingLocationId: null })
    );
  });

  it('handles an empty fleet without throwing', async () => {
    loadParkingCheckCandidates.mockResolvedValue([]);
    const report = await runParkingCheck(CHECK_AT);
    expect(report.evaluated).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.results).toEqual([]);
  });

  it('maintains the invariant sum(counts) + errors === evaluated', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate(),
      candidate({ vehicleId: 'veh-2', location: null }),
      candidate({ vehicleId: 'veh-3', hasTracker: false }),
    ]);
    insertComplianceCheck
      .mockResolvedValueOnce(wroteNew)
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(wroteNew);

    const report = await runParkingCheck(CHECK_AT);

    const countSum =
      report.counts.compliant +
      report.counts.violation +
      report.counts.unknown +
      report.counts.not_verifiable +
      report.counts.no_address;

    expect(countSum + report.errors).toBe(report.evaluated);
  });

  it('does not increment result bucket when insert fails', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    insertComplianceCheck.mockRejectedValueOnce(new Error('constraint violation'));

    const report = await runParkingCheck(CHECK_AT);

    expect(report.counts.compliant).toBe(0);
    expect(report.errors).toBe(1);
  });
});

/**
 * The alerting seam PR 2 consumes. `inserted` alone is the wrong key: the run
 * that discovers a violation is very often an update, not an insert.
 */
describe('runParkingCheck — newViolation', () => {
  const away = candidate({
    // ~40 km from the declared location: well outside the 200 m radius.
    lastFix: { recordedAt: new Date(CHECK_AT.getTime() - 3600_000), lat: -25.8, lon: 28.3 },
  });

  it('is true for a violation recorded for the first time today', async () => {
    loadParkingCheckCandidates.mockResolvedValue([away]);
    insertComplianceCheck.mockResolvedValue(wroteNew);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.results[0]!.result).toBe('violation');
    expect(report.results[0]!.newViolation).toBe(true);
  });

  // The case `inserted` gets wrong: the 20:00 run wrote `unknown` against a
  // lagging feed, and this 20:30 re-run is the first to see the violation.
  it('is true when a re-run upgrades an earlier non-violation to a violation', async () => {
    loadParkingCheckCandidates.mockResolvedValue([away]);
    insertComplianceCheck.mockResolvedValue(overwrote('unknown'));

    const report = await runParkingCheck(CHECK_AT);

    expect(report.results[0]!.inserted).toBe(false);
    expect(report.results[0]!.newViolation).toBe(true);
  });

  it('is false when a re-run finds the same violation already recorded', async () => {
    loadParkingCheckCandidates.mockResolvedValue([away]);
    insertComplianceCheck.mockResolvedValue(overwrote('violation'));

    const report = await runParkingCheck(CHECK_AT);

    expect(report.results[0]!.result).toBe('violation');
    expect(report.results[0]!.newViolation).toBe(false);
  });

  it('is false for any non-violation result', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    insertComplianceCheck.mockResolvedValue(wroteNew);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.results[0]!.result).toBe('compliant');
    expect(report.results[0]!.newViolation).toBe(false);
  });
});
