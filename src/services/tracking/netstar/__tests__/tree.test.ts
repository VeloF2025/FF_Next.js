import { describe, it, expect } from 'vitest';
import { parseAspNetDate, parseVehicleTree } from '../tree';

/**
 * Shapes taken verbatim from the live portal on 2026-08-07 (Velocity FIBRE
 * account, ~11.5k vehicles across a multi-client reseller tree).
 */
const FOLDER = {
  ChassisVin: null, Index: 0, Id: '1_0_0', DeptId: '1_0_0', GrpId: '1_0_0',
  Name: 'Clients', LeafId: 0, LeafName: 'Not set', SecondaryName: '',
  DateTimeUtc: '/Date(-62135596800000)/', GroupName: 'Clients',
};
const VEHICLE = {
  ChassisVin: 'MBHZCDESR00394156', Index: 2, Id: '1_11_12832', GrpId: '1_11_0',
  Name: 'LN40MGGP', LeafId: 14274, LeafName: 'LN40MGGP', SecondaryName: '',
  DateTimeUtc: '/Date(1786039740000)/', GroupName: 'Ungrouped',
  Lat: -26.089847564697266, Long: 28.35436248779297,
  SpeedValue: 0, Dir: 158, IgnitionOn: false,
};

describe('parseAspNetDate', () => {
  it('reads epoch milliseconds out of the ASP.NET wrapper', () => {
    expect(parseAspNetDate('/Date(1786039740000)/')?.toISOString())
      .toBe('2026-08-06T18:09:00.000Z');
  });

  it('ignores a trailing timezone offset, which is redundant', () => {
    // The epoch value is already UTC; the offset only says how the portal
    // would render it. Honouring it would double-shift every fix by 2h.
    expect(parseAspNetDate('/Date(1786039740000+0200)/')?.getTime())
      .toBe(parseAspNetDate('/Date(1786039740000)/')?.getTime());
  });

  // Folder rows carry DateTime.MinValue. Treating that as a fix would write a
  // year-0001 position and drag any watermark derived from it back to then.
  it('rejects DateTime.MinValue rather than returning year 0001', () => {
    expect(parseAspNetDate('/Date(-62135596800000)/')).toBeNull();
  });

  it('rejects anything that is not the expected wrapper', () => {
    for (const bad of ['2026-08-06T13:29:00Z', '', '/Date()/', 'null', null, undefined, 42]) {
      expect(parseAspNetDate(bad as unknown)).toBeNull();
    }
  });
});

describe('parseVehicleTree', () => {
  it('returns vehicle leaves and skips folder nodes', () => {
    const nodes = parseVehicleTree({ data: [FOLDER, VEHICLE] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ externalId: '14274', registration: 'LN40MGGP', groupName: 'Ungrouped' });
  });

  it('maps the fix onto a ProviderPosition, with the portal time as recordedAt', () => {
    // recordedAt must be the fix time, never now(): the dedup key is
    // syn:<account>:<external>:<recordedAt>, so stamping now() would make every
    // poll of an unchanged fix insert a new row.
    const [n] = parseVehicleTree({ data: [VEHICLE] });
    expect(n!.position).toMatchObject({
      externalId: '14274',
      providerEventId: null,
      lat: -26.089847564697266,
      lon: 28.35436248779297,
      speedKph: 0,
      ignition: false,
      bearing: 158,
    });
    expect(n!.position!.recordedAt.toISOString()).toBe('2026-08-06T18:09:00.000Z');
  });

  // A vehicle the portal has never had a fix for still has to be listed, or
  // discovery cannot map it and it stays invisible forever.
  it('lists a vehicle with no usable fix, with a null position', () => {
    const nodes = parseVehicleTree({ data: [{ ...VEHICLE, Lat: null, Long: null }] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.position).toBeNull();
  });

  it('drops a fix whose coordinates are out of range instead of storing it', () => {
    const nodes = parseVehicleTree({ data: [{ ...VEHICLE, Lat: 200 }] });
    expect(nodes[0]!.position).toBeNull();
    expect(nodes[0]!.externalId).toBe('14274');
  });

  it('drops a fix with a MinValue timestamp but keeps the vehicle', () => {
    const nodes = parseVehicleTree({ data: [{ ...VEHICLE, DateTimeUtc: '/Date(-62135596800000)/' }] });
    expect(nodes[0]!.position).toBeNull();
  });

  it('skips a malformed row without failing the whole tree', () => {
    const nodes = parseVehicleTree({ data: [null, 'nonsense', VEHICLE, { LeafId: 'x' }] });
    expect(nodes.map((n) => n.externalId)).toEqual(['14274']);
  });

  // "We could not parse it" must never reach discovery looking like "the
  // account has no vehicles" — that is what triggers a wholesale unmap.
  it('throws on a response that is not the expected envelope', () => {
    expect(() => parseVehicleTree([VEHICLE])).toThrow(/no `data` envelope/);
    expect(() => parseVehicleTree({ data: 'nope' })).toThrow(/expected an array/);
    expect(() => parseVehicleTree(null)).toThrow(/no `data` envelope/);
  });

  it('reads numeric strings, which the portal mixes in', () => {
    const [n] = parseVehicleTree({ data: [{ ...VEHICLE, Lat: '-26.1', Long: '28.3', SpeedValue: '42' }] });
    expect(n!.position).toMatchObject({ lat: -26.1, lon: 28.3, speedKph: 42 });
  });
});
