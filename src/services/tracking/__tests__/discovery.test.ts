import { describe, it, expect, vi } from 'vitest';
import { reconcileTrackers } from '../discovery';

const fleet = [
  { id: 'v1', registration: 'LN40MGGP' },
  { id: 'v2', registration: 'LG94NLGP' },
];

function deps(overrides = {}) {
  return {
    loadActiveFleet: async () => fleet,
    assignTracker: vi.fn(async () => {}),
    deactivateMissing: vi.fn(async () => 0),
    countActiveTrackers: vi.fn(async () => 0),
    // Nobody else is tracking these vehicles unless a case says so.
    loadTrackedElsewhere: vi.fn(async () => new Set<string>()),
    ...overrides,
  };
}

describe('reconcileTrackers', () => {
  it('assigns a tracker per matched vehicle', async () => {
    const d = deps();
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(r.upserted).toBe(1);
    expect(d.assignTracker).toHaveBeenCalledWith('v1', 'netstar', 'europcar', '1447952');
  });

  it('reports fleet vehicles the portal does not know about', async () => {
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], deps()
    );
    expect(r.fleetOnly.map((f) => f.registration)).toEqual(['LG94NLGP']);
  });

  it('reports portal vehicles absent from the fleet', async () => {
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '999', registration: 'ZZ99ZZGP' }], deps()
    );
    expect(r.portalOnly.map((p) => p.externalId)).toEqual(['999']);
  });

  it('never writes a tracker row for an unmatched portal vehicle', async () => {
    const d = deps();
    await reconcileTrackers('netstar', 'europcar', [{ externalId: '999', registration: null }], d);
    expect(d.assignTracker).not.toHaveBeenCalled();
  });

  it('assigns each matched vehicle exactly once via the atomic assignTracker call', async () => {
    // uq_fleet_trackers_one_active_per_vehicle allows exactly one active row.
    // assignTracker (backed by setVehicleTracker's single transaction) is what
    // keeps deactivate-then-activate atomic — it must never be split back into
    // two separate calls, or a failure between them could leave the vehicle
    // with zero active trackers.
    const d = deps();
    await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(d.assignTracker).toHaveBeenCalledTimes(1);
    expect(d.assignTracker).toHaveBeenCalledWith('v1', 'netstar', 'europcar', '1447952');
  });

  it('deactivates tracker rows the portal no longer lists', async () => {
    const d = deps({ deactivateMissing: vi.fn(async () => 2) });
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(r.deactivated).toBe(2);
    expect(d.deactivateMissing).toHaveBeenCalledWith('netstar', 'europcar', ['1447952']);
  });

  it('treats an empty portal list as a fetch failure: no deactivation, no assignment', async () => {
    const d = deps({ deactivateMissing: vi.fn(async () => 0) });
    const r = await reconcileTrackers('netstar', 'europcar', [], d);
    expect(d.assignTracker).not.toHaveBeenCalled();
    expect(d.deactivateMissing).not.toHaveBeenCalled();
    expect(r.upserted).toBe(0);
    expect(r.deactivated).toBe(0);
    expect(r.portalOnly).toEqual([]);
    expect(r.fleetOnly).toEqual(fleet);
    expect(r.deactivationSuppressed).toBe(false);
  });

  describe('wholesale unmapping is never a legitimate outcome of one poll', () => {
    // A ten-vehicle account, so "more than half" has room to be a real number
    // rather than an artefact of a two-row fixture.
    const tenFleet = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`, registration: `LN4${i}MGGP`,
    }));
    const tenPortal = tenFleet.map((f, i) => ({
      externalId: `e${i}`, registration: f.registration,
    }));

    it('deactivates nothing when a NON-EMPTY portal list matches no fleet vehicle', async () => {
      // The report tree returning client/group folder nodes instead of
      // vehicles: well-formed {id, name} objects that match no registration.
      const d = deps({
        loadActiveFleet: async () => tenFleet,
        countActiveTrackers: vi.fn(async () => 10),
        deactivateMissing: vi.fn(async () => 10),
      });
      const folders = [
        { externalId: '900', registration: 'Europcar Gauteng' },
        { externalId: '901', registration: 'Europcar Western Cape' },
      ];
      const r = await reconcileTrackers('netstar', 'europcar', folders, d);
      expect(d.deactivateMissing).not.toHaveBeenCalled();
      expect(d.assignTracker).not.toHaveBeenCalled();
      expect(r.upserted).toBe(0);
      expect(r.deactivated).toBe(0);
      expect(r.portalOnly).toEqual(folders);
      expect(r.fleetOnly).toEqual(tenFleet);
    });

    it('deactivates nothing and flags the run when a partial match would unmap more than half', async () => {
      const d = deps({
        loadActiveFleet: async () => tenFleet,
        countActiveTrackers: vi.fn(async () => 10),
        deactivateMissing: vi.fn(async () => 8),
      });
      const r = await reconcileTrackers('netstar', 'europcar', tenPortal.slice(0, 2), d);
      expect(d.deactivateMissing).not.toHaveBeenCalled();
      expect(r.deactivated).toBe(0);
      expect(r.deactivationSuppressed).toBe(true);
      // The two that DID match are still mapped — the brake stops removals,
      // not the coverage this poll actually established.
      expect(d.assignTracker).toHaveBeenCalledTimes(2);
      expect(r.upserted).toBe(2);
    });

    it('proceeds normally when a partial match removes only one of ten', async () => {
      const d = deps({
        loadActiveFleet: async () => tenFleet,
        countActiveTrackers: vi.fn(async () => 10),
        deactivateMissing: vi.fn(async () => 1),
      });
      const r = await reconcileTrackers('netstar', 'europcar', tenPortal.slice(0, 9), d);
      expect(d.deactivateMissing).toHaveBeenCalledWith(
        'netstar', 'europcar', tenPortal.slice(0, 9).map((p) => p.externalId)
      );
      expect(r.deactivated).toBe(1);
      expect(r.deactivationSuppressed).toBe(false);
    });

    it('counts active trackers before writing anything, so the denominator is the pre-run state', async () => {
      const calls: string[] = [];
      const d = deps({
        loadActiveFleet: async () => tenFleet,
        countActiveTrackers: vi.fn(async () => { calls.push('count'); return 10; }),
        assignTracker: vi.fn(async () => { calls.push('assign'); }),
        deactivateMissing: vi.fn(async () => { calls.push('deactivate'); return 1; }),
      });
      await reconcileTrackers('netstar', 'europcar', tenPortal.slice(0, 9), d);
      expect(calls[0]).toBe('count');
      expect(calls[calls.length - 1]).toBe('deactivate');
    });
  });
});

/**
 * The takeover guard.
 *
 * uq_fleet_trackers_one_active_per_vehicle is fleet-wide, and
 * setVehicleTracker's deactivate is `WHERE vehicle_id = $1 AND is_active` with
 * no provider predicate — so without this filter, assigning a Netstar tracker
 * to a vehicle Cartrack already tracks switches the Cartrack row off. The
 * vehicle silently drops from a 2-minute REST feed to a 2-hourly scrape,
 * poll-tracking.ts then discards its positions as unmapped at log.info, and
 * nothing ever maps it back.
 */
describe('reconcileTrackers — never takes a vehicle off another provider', () => {
  it('skips a matched vehicle that another provider already tracks', async () => {
    const d = deps({ loadTrackedElsewhere: vi.fn(async () => new Set(['v1'])) });

    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [
        { externalId: '1447952', registration: 'LN40MGGP' }, // v1 — Cartrack's
        { externalId: '1447953', registration: 'LG94NLGP' }, // v2 — free
      ],
      d
    );

    expect(d.assignTracker).toHaveBeenCalledTimes(1);
    expect(d.assignTracker).toHaveBeenCalledWith('v2', 'netstar', 'europcar', '1447953');
    expect(r.upserted).toBe(1);
    expect(r.skippedOtherProvider).toEqual([
      { vehicleId: 'v1', registration: 'LN40MGGP' },
    ]);
  });

  it('writes nothing at all when every match is already tracked elsewhere', async () => {
    // Same reasoning as the zero-match guard: proceeding would hand
    // deactivateMissing an empty keep list and unmap the whole account.
    const d = deps({ loadTrackedElsewhere: vi.fn(async () => new Set(['v1', 'v2'])) });

    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [
        { externalId: '1447952', registration: 'LN40MGGP' },
        { externalId: '1447953', registration: 'LG94NLGP' },
      ],
      d
    );

    expect(d.assignTracker).not.toHaveBeenCalled();
    expect(d.deactivateMissing).not.toHaveBeenCalled();
    expect(r.upserted).toBe(0);
    expect(r.matchedNone).toBe(true);
    expect(r.skippedOtherProvider).toHaveLength(2);
  });

  it('does not skip a vehicle this same provider/account already tracks', async () => {
    // loadTrackedElsewhere excludes our own rows: re-confirming an existing
    // mapping every tick is the normal, healthy path and must not be filtered.
    const d = deps({ loadTrackedElsewhere: vi.fn(async () => new Set<string>()) });

    const r = await reconcileTrackers(
      'netstar', 'europcar', [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );

    expect(d.assignTracker).toHaveBeenCalledWith('v1', 'netstar', 'europcar', '1447952');
    expect(r.skippedOtherProvider).toEqual([]);
  });
});

describe('reconcileTrackers — the deactivation brake includes its own boundary', () => {
  // `wouldDeactivate > activeBefore * 0.5` let EXACTLY half through: 5 of 10,
  // which is what a report truncated to the first of two equal pages produces.
  // The comment on the constant says a shape change "removes exactly that much
  // in one go" — so the boundary is the case it exists to catch.
  it('suppresses a deactivation of exactly half the account', async () => {
    const tenVehicles = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`, registration: `AA${i}AAGP`,
    }));
    const d = deps({
      loadActiveFleet: async () => tenVehicles,
      countActiveTrackers: vi.fn(async () => 10),
    });

    const r = await reconcileTrackers(
      'netstar', 'europcar',
      tenVehicles.slice(0, 5).map((v, i) => ({ externalId: `e${i}`, registration: v.registration })),
      d
    );

    expect(r.deactivationSuppressed).toBe(true);
    expect(d.deactivateMissing).not.toHaveBeenCalled();
    // The five that DID match are still mapped — suppressing a deactivation is
    // not the same as abandoning the tick.
    expect(d.assignTracker).toHaveBeenCalledTimes(5);
  });

  it('does not suppress when nothing would be deactivated on a fresh account', async () => {
    // activeBefore = 0 makes `wouldDeactivate >= activeBefore * 0.5` read
    // `0 >= 0` — true — which would brake every first run forever.
    const d = deps({ countActiveTrackers: vi.fn(async () => 0) });

    const r = await reconcileTrackers(
      'netstar', 'europcar', [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );

    expect(r.deactivationSuppressed).toBe(false);
    expect(d.deactivateMissing).toHaveBeenCalled();
  });
});
