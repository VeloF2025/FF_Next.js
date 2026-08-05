import { describe, it, expect, vi } from 'vitest';
import { reconcileTrackers } from '../discovery';

const fleet = [
  { id: 'v1', registration: 'LN40MGGP' },
  { id: 'v2', registration: 'LG94NLGP' },
];

function deps(overrides = {}) {
  return {
    loadActiveFleet: async () => fleet,
    deactivateOthersForVehicle: vi.fn(async () => {}),
    upsertTracker: vi.fn(async () => {}),
    deactivateMissing: vi.fn(async () => 0),
    ...overrides,
  };
}

describe('reconcileTrackers', () => {
  it('upserts a tracker row per matched vehicle', async () => {
    const d = deps();
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(r.upserted).toBe(1);
    expect(d.upsertTracker).toHaveBeenCalledWith('netstar', 'europcar', '1447952', 'v1');
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
    expect(d.upsertTracker).not.toHaveBeenCalled();
  });

  it('deactivates a vehicle\'s other active tracker before activating this one', async () => {
    // uq_fleet_trackers_one_active_per_vehicle allows exactly one. Newest wins.
    const order: string[] = [];
    const d = deps({
      upsertTracker: vi.fn(async () => { order.push('upsert'); }),
      deactivateOthersForVehicle: vi.fn(async () => { order.push('deactivate'); }),
    });
    await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(d.deactivateOthersForVehicle)
      .toHaveBeenCalledWith('v1', 'netstar', 'europcar', '1447952');
    expect(order).toEqual(['deactivate', 'upsert']);
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
});
