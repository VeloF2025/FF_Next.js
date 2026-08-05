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
