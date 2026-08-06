import { describe, it, expect } from 'vitest';
import { normaliseRegistration, matchVehicles } from '../registration';

describe('normaliseRegistration', () => {
  it('uppercases and strips spaces and hyphens', () => {
    expect(normaliseRegistration(' ln 40-mggp ')).toBe('LN40MGGP');
  });
  it('returns empty string for junk', () => {
    expect(normaliseRegistration('   ')).toBe('');
  });
});

describe('matchVehicles', () => {
  const fleet = [
    { id: 'v1', registration: 'LN40MGGP' },
    { id: 'v2', registration: 'LG94NLGP' },
  ];

  it('matches on normalised registration', () => {
    const r = matchVehicles([{ externalId: '1447952', registration: 'ln40 mggp' }], fleet);
    expect(r.matched).toEqual([
      { externalId: '1447952', vehicleId: 'v1', registration: 'LN40MGGP' },
    ]);
  });

  it('reports portal vehicles absent from the fleet', () => {
    const r = matchVehicles([{ externalId: '99', registration: 'ZZ99ZZGP' }], fleet);
    expect(r.portalOnly.map((p) => p.externalId)).toEqual(['99']);
  });

  it('reports fleet vehicles absent from the portal', () => {
    const r = matchVehicles([{ externalId: '1447952', registration: 'LN40MGGP' }], fleet);
    expect(r.fleetOnly.map((f) => f.id)).toEqual(['v2']);
  });

  it('treats a null portal registration as unmatchable, not as a wildcard', () => {
    const r = matchVehicles([{ externalId: '544524626', registration: null }], fleet);
    expect(r.matched).toEqual([]);
    expect(r.portalOnly).toHaveLength(1);
  });

  it('does not match two portal vehicles to the same fleet row', () => {
    const r = matchVehicles(
      [
        { externalId: 'a', registration: 'LN40MGGP' },
        { externalId: 'b', registration: 'LN40MGGP' },
      ],
      fleet
    );
    expect(r.matched).toHaveLength(1);
    expect(r.portalOnly.map((p) => p.externalId)).toContain('b');
  });
});

/**
 * Ambiguity in either direction. Both cases end in a position row stored
 * against the wrong vehicle, and the position dedup key (syn:account:external:
 * recordedAt) does not include vehicle_id — so a later correct reconcile cannot
 * repair it: the corrected insert collides and is dropped. Refusing the match
 * is the only reversible option.
 */
describe('matchVehicles — ambiguity is refused, not resolved', () => {
  it('refuses two portal entries that share an external id', () => {
    // fleet_vehicle_trackers is UNIQUE on (provider, account_ref, external_id)
    // with DO UPDATE SET vehicle_id, so mapping both does not create two rows —
    // the second STEALS the tracker from the first inside a single tick, and
    // that vehicle ends the run with no active tracker while the report still
    // claims two upserts.
    const r = matchVehicles(
      [
        { externalId: '1447952', registration: 'LN40MGGP' },
        { externalId: '1447952', registration: 'LG94NLGP' },
      ],
      [
        { id: 'v1', registration: 'LN40MGGP' },
        { id: 'v2', registration: 'LG94NLGP' },
      ]
    );

    expect(r.matched).toEqual([
      { externalId: '1447952', vehicleId: 'v1', registration: 'LN40MGGP' },
    ]);
    expect(r.portalOnly.map((p) => p.registration)).toEqual(['LG94NLGP']);
    expect(r.ambiguous).toEqual([{ reason: 'duplicate-portal-id', key: '1447952' }]);
  });

  it('allows a repeated external id when the first occurrence never matched', () => {
    // Only a MATCHED external id is spent. A folder node repeated in the report
    // tree must not lock out the real vehicle that carries the same id.
    const r = matchVehicles(
      [
        { externalId: '77', registration: 'NOT-OURS' },
        { externalId: '77', registration: 'LN40MGGP' },
      ],
      [{ id: 'v1', registration: 'LN40MGGP' }]
    );

    expect(r.matched).toEqual([
      { externalId: '77', vehicleId: 'v1', registration: 'LN40MGGP' },
    ]);
    expect(r.ambiguous).toEqual([]);
  });

  it('refuses two fleet rows whose registrations normalise the same', () => {
    // fleet_vehicles.registration is UNIQUE on the RAW string, so "LN40 MGGP"
    // and "LN40-MGGP" can both exist. A plain Map.set would let the later one
    // win silently and demote the other to fleetOnly, indistinguishable from a
    // vehicle the portal simply does not carry.
    const r = matchVehicles(
      [{ externalId: '1447952', registration: 'LN40MGGP' }],
      [
        { id: 'v1', registration: 'LN40 MGGP' },
        { id: 'v2', registration: 'LN40-MGGP' },
      ]
    );

    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toEqual([
      { reason: 'duplicate-fleet-registration', key: 'LN40MGGP' },
    ]);
    // Neither is claimed, so neither is silently reported as "mapped".
    expect(r.fleetOnly.map((f) => f.id)).toEqual(['v1', 'v2']);
  });
});
