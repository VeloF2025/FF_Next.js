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
  });
});
