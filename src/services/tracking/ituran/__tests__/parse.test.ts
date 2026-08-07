/**
 * Fixture is a trimmed copy of a real PeleGrid response captured from the live
 * portal on 2026-08-07 (both Avis vehicles). Field names and the three
 * differently-zoned timestamps are verbatim — do not "tidy" them.
 */
import { describe, expect, it } from 'vitest';
import {
  isLoginError,
  newestFixAt,
  parseUtcTimestamp,
  readIgnition,
  toPositions,
  toVehicles,
  type IturanGridResponse,
} from '../parse';

const WIDE_FROM = new Date('2026-08-01T00:00:00Z');
const WIDE_TO = new Date('2026-08-31T00:00:00Z');

const LIVE: IturanGridResponse = {
  ResultType: 'ALL_DATA',
  ErrorStr: 'OK',
  DataTimeStamp: '2026-08-07 13:27:01', // Israel time (UTC+3) — envelope only
  rows_data: {
    '1242358': {
      PlatformId: 1242358,
      Plate: 'KX82PLGP',
      Label: 'KX82PLGP (R)',
      Lat: -25.9742,
      Lon: 28.21489,
      LastSpeed: 0,
      LastHead: 346,
      LastMileage: '89718',
      SpeedLimit: 60,
      Location_RowLocTime: '2026-08-07 10:26:54', // UTC
      Statuses: [
        { StatName: 'Ignition Off' },
        { StatName: 'Engine Off' },
        { StatName: 'Vehicle Stopped' },
      ],
    },
    '2305830': {
      PlatformId: 2305830,
      Plate: 'KW96KRGP',
      Label: 'KW96KRGP (R)',
      Lat: -26.75209,
      Lon: 27.00402,
      LastSpeed: 82,
      LastHead: 230,
      LastMileage: '105624',
      SpeedLimit: 60,
      Location_RowLocTime: '2026-08-07 10:26:53', // UTC
      Statuses: [{ StatName: 'Engine On' }],
    },
  },
};

describe('parseUtcTimestamp', () => {
  it('reads Location_RowLocTime as UTC, not as server-local time', () => {
    // The bug this guards: `new Date('2026-08-07 10:26:54')` is parsed as LOCAL
    // time by V8, so on the SAST deploy host it would yield 08:26:54Z — every
    // fix shifted two hours early.
    expect(parseUtcTimestamp('2026-08-07 10:26:54')?.toISOString())
      .toBe('2026-08-07T10:26:54.000Z');
  });

  it('rejects the SAST display format rather than silently misreading it', () => {
    // LastGoodLocTimeStr is "07/08/2026 12:26:54" — day-first and local. If it
    // ever reached this function, returning null is far safer than guessing.
    expect(parseUtcTimestamp('07/08/2026 12:26:54')).toBeNull();
  });

  it('returns null for empty and malformed input', () => {
    expect(parseUtcTimestamp(null)).toBeNull();
    expect(parseUtcTimestamp('')).toBeNull();
    expect(parseUtcTimestamp('not a date')).toBeNull();
  });

  it('rejects impossible calendar days instead of rolling them over', () => {
    // V8 silently rolls these: new Date('2026-02-30T…Z') is 2 March, a VALID
    // Date. Shape-checking plus a NaN test would let a corrupted day field
    // through as a wrong-but-plausible instant days away from the truth.
    expect(parseUtcTimestamp('2026-02-30 10:26:54')).toBeNull();
    expect(parseUtcTimestamp('2026-04-31 10:26:54')).toBeNull();
    expect(parseUtcTimestamp('2025-02-29 10:26:54')).toBeNull(); // 2025 is not a leap year
  });

  it('still accepts genuinely valid edge dates', () => {
    expect(parseUtcTimestamp('2024-02-29 00:00:00')?.toISOString())
      .toBe('2024-02-29T00:00:00.000Z'); // 2024 IS a leap year
    expect(parseUtcTimestamp('2026-12-31 23:59:59')?.toISOString())
      .toBe('2026-12-31T23:59:59.000Z');
  });
});

describe('toPositions', () => {
  it('maps both live vehicles with UTC instants', () => {
    const out = toPositions(LIVE, WIDE_FROM, WIDE_TO);
    expect(out).toHaveLength(2);
    const kx = out.find((p) => p.externalId === '1242358');
    expect(kx).toMatchObject({
      lat: -25.9742,
      lon: 28.21489,
      speedKph: 0,
      bearing: 346,
      odometerKm: 89718,
      ignition: false,
      providerEventId: null,
    });
    expect(kx?.recordedAt.toISOString()).toBe('2026-08-07T10:26:54.000Z');
  });

  it('flags speeding only when both speed and limit are known', () => {
    const out = toPositions(LIVE, WIDE_FROM, WIDE_TO);
    expect(out.find((p) => p.externalId === '2305830')?.isSpeeding).toBe(true);
    expect(out.find((p) => p.externalId === '1242358')?.isSpeeding).toBe(false);

    const noLimit = toPositions(
      { ...LIVE, rows_data: { a: { PlatformId: 'a', Lat: 1, Lon: 2, LastSpeed: 99, Location_RowLocTime: '2026-08-07 10:00:00' } } },
      WIDE_FROM, WIDE_TO
    );
    expect(noLimit[0]?.isSpeeding).toBeNull();
  });

  it('drops a null-island fix instead of putting the vehicle in the Atlantic', () => {
    const out = toPositions(
      { rows_data: { z: { PlatformId: 'z', Plate: 'ZZ99ZZGP', Lat: 0, Lon: 0, Location_RowLocTime: '2026-08-07 10:00:00' } } },
      WIDE_FROM, WIDE_TO
    );
    expect(out).toHaveLength(0);
  });

  it('drops rows with no parseable timestamp or no coordinates', () => {
    const out = toPositions(
      {
        rows_data: {
          a: { PlatformId: 'a', Lat: -26, Lon: 28, Location_RowLocTime: null },
          b: { PlatformId: 'b', Lat: null, Lon: 28, Location_RowLocTime: '2026-08-07 10:00:00' },
        },
      },
      WIDE_FROM, WIDE_TO
    );
    expect(out).toHaveLength(0);
  });

  it('filters to the requested window', () => {
    const out = toPositions(LIVE, new Date('2026-08-07T10:26:54Z'), new Date('2026-08-07T10:26:54Z'));
    // Inclusive on both ends: only the 10:26:54 fix qualifies, not the :53 one.
    expect(out.map((p) => p.externalId)).toEqual(['1242358']);
  });

  it('refuses BOTH rows when two resolve to the same externalId', () => {
    // PlatformId is identity; the dict key is only a fallback. A row missing
    // its PlatformId whose key collides with another row's real one would
    // otherwise attribute one vehicle's position to the other — and the ingest
    // dedup key carries no vehicle_id, so that is unrepairable.
    const out = toPositions(
      {
        rows_data: {
          // No PlatformId — falls back to its own key, '999'.
          '999': { Plate: 'AA11AAGP', Lat: -26, Lon: 28, Location_RowLocTime: '2026-08-07 10:00:00' },
          // A different key, but its real PlatformId is 999 — they collide.
          zzz: { PlatformId: 999, Plate: 'BB22BBGP', Lat: -25, Lon: 27, Location_RowLocTime: '2026-08-07 10:00:01' },
          '111': { PlatformId: 111, Plate: 'CC33CCGP', Lat: -24, Lon: 26, Location_RowLocTime: '2026-08-07 10:00:02' },
        },
      },
      WIDE_FROM, WIDE_TO
    );
    // The uncontested row survives; neither contender does.
    expect(out.map((p) => p.externalId)).toEqual(['111']);
  });

  it('survives a missing or malformed rows_data without throwing', () => {
    expect(toPositions({}, WIDE_FROM, WIDE_TO)).toEqual([]);
    expect(toPositions({ rows_data: null }, WIDE_FROM, WIDE_TO)).toEqual([]);
  });
});

describe('toVehicles', () => {
  it('uses Plate, never the suffixed Label', () => {
    // Label is "KW96KRGP (R)"; matching on it would normalise to KW96KRGPR and
    // never find the fleet row.
    expect(toVehicles(LIVE)).toEqual([
      { externalId: '1242358', registration: 'KX82PLGP', groupName: null },
      { externalId: '2305830', registration: 'KW96KRGP', groupName: null },
    ]);
  });

  it('yields a null registration rather than an empty string', () => {
    expect(toVehicles({ rows_data: { q: { PlatformId: 'q', Plate: '  ' } } }))
      .toEqual([{ externalId: 'q', registration: null, groupName: null }]);
  });
});

describe('newestFixAt', () => {
  it('returns the newest fix across the account', () => {
    expect(newestFixAt(LIVE)?.toISOString()).toBe('2026-08-07T10:26:54.000Z');
  });

  it('returns null when nothing on the account has a parseable fix', () => {
    expect(newestFixAt({ rows_data: { a: { PlatformId: 'a' } } })).toBeNull();
    expect(newestFixAt({})).toBeNull();
  });
});

describe('readIgnition', () => {
  it('reads ignition state from the status list', () => {
    expect(readIgnition([{ StatName: 'Ignition On' }])).toBe(true);
    expect(readIgnition([{ StatName: 'Engine Off' }, { StatName: 'Ignition Off' }])).toBe(false);
  });

  it('is null for a moving vehicle reporting only Engine On', () => {
    // Verbatim from the live capture of KW96KRGP while driving: the portal
    // sent Engine On and no ignition status. Asserted so the honest-unknown
    // choice is visible rather than looking like an oversight.
    expect(readIgnition([{ StatName: 'Engine On' }])).toBeNull();
    expect(toPositions(LIVE, WIDE_FROM, WIDE_TO).find((p) => p.externalId === '2305830')?.ignition)
      .toBeNull();
  });

  it('is null — not false — when the portal does not say', () => {
    // Downstream parking compliance treats false as a definite state, so an
    // unknown must not masquerade as "engine off".
    expect(readIgnition([{ StatName: 'Vehicle Stopped' }])).toBeNull();
    expect(readIgnition(null)).toBeNull();
    expect(readIgnition([])).toBeNull();
  });
});

describe('isLoginError', () => {
  it('detects the dead-token body that rides on a 200-family status', () => {
    expect(isLoginError({ ResultType: 'ALL_DATA', ErrorStr: 'LoginError!' })).toBe(true);
    expect(isLoginError({ ResultType: 'ALL_DATA', ErrorStr: 'OK' })).toBe(false);
    expect(isLoginError({})).toBe(false);
  });
});

describe('newestFixAt — future-dated fixes must not defeat the dead-feed probe', () => {
  const NOW = new Date('2026-08-07T14:00:00Z');

  it('ignores a fix from a rolled-over device clock', () => {
    // Same defect as the Cartrack portal parser: a negative feedAgeMs makes
    // gapReason's staleness check permanently false, and for a snapshot
    // provider that is the only dead-feed signal there is.
    const res: IturanGridResponse = { rows_data: {
      broken: { PlatformId: 'broken', Plate: 'AA11AAGP', Lat: -26, Lon: 28, Location_RowLocTime: '2043-01-01 00:00:00' },
      real:   { PlatformId: 'real',   Plate: 'BB22BBGP', Lat: -25, Lon: 27, Location_RowLocTime: '2026-08-01 09:00:00' },
    } };
    const newest = newestFixAt(res, NOW);
    expect(newest?.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    expect(newest!.getTime()).toBeLessThan(NOW.getTime());
  });

  it('still accepts a fix inside the clock-skew tolerance ingest allows', () => {
    const res: IturanGridResponse = { rows_data: {
      skewed: { PlatformId: 'skewed', Plate: 'CC33CCGP', Lat: -26, Lon: 28, Location_RowLocTime: '2026-08-07 14:02:00' },
    } };
    expect(newestFixAt(res, NOW)?.toISOString()).toBe('2026-08-07T14:02:00.000Z');
  });

  it('returns null when EVERY fix is future-dated', () => {
    const res: IturanGridResponse = { rows_data: {
      a: { PlatformId: 'a', Plate: 'DD44DDGP', Lat: -26, Lon: 28, Location_RowLocTime: '2043-01-01 00:00:00' },
    } };
    expect(newestFixAt(res, NOW)).toBeNull();
  });
});
