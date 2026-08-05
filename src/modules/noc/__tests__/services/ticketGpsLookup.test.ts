/**
 * Pins the DB-querying half of ticketGpsService.
 *
 * The pure helpers are covered in ticketGpsService.test.ts. These three are the
 * ones every production call site actually depends on, and they were shipped
 * with no coverage at all — a blind review caught it.
 *
 * The gap mattered more than "some functions lack tests": vitest.setup.ts
 * auto-mocks `@/lib/db` as `pool: { query: vi.fn() }`, and a bare vi.fn()
 * returns `undefined`. Reading `result.rows[0]` off that throws a TypeError,
 * which lookupOesGps* swallows in its own catch and reports as "no GPS". So
 * every pre-existing test touching these functions passed while exercising only
 * the null path, and would have kept passing if the SQL were complete nonsense.
 * These tests supply a real mock so both paths are actually reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...a: unknown[]) => queryMock(...a) },
  pool: { query: (...a: unknown[]) => queryMock(...a) },
}));

import {
  lookupOesGpsByDr,
  lookupOesGpsBySerial,
  lookupOesGps,
} from '@/modules/noc/services/ticketGpsService';

/** pg returns numeric columns as strings — mirror that, don't hand back numbers. */
const row = (lat: string, lng: string) => ({ rows: [{ latitude: lat, longitude: lng }] });
const empty = { rows: [] };

beforeEach(() => queryMock.mockReset());

describe('lookupOesGpsByDr', () => {
  it('returns the coordinate as numbers, converting pg text', async () => {
    queryMock.mockResolvedValueOnce(row('-26.7387387', '27.0148998'));
    expect(await lookupOesGpsByDr('DR100')).toEqual({
      latitude: -26.7387387,
      longitude: 27.0148998,
    });
  });

  it('parameterises the DR and the bounding box — no interpolation', async () => {
    queryMock.mockResolvedValueOnce(empty);
    await lookupOesGpsByDr('DR100');
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('DR100');
    expect(params).toEqual(['DR100', -35, -22, 16, 33]);
  });

  it('bounds the query in SQL so an out-of-country row never reaches the caller', async () => {
    queryMock.mockResolvedValueOnce(empty);
    await lookupOesGpsByDr('DR1');
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toMatch(/latitude BETWEEN/i);
    expect(sql).toMatch(/longitude BETWEEN/i);
  });

  it('needs no recency tiebreak — oes_activations is UNIQUE (drop_number)', async () => {
    // An earlier version ordered by activation_date here and claimed "latest
    // activation wins". The unique constraint means there is at most one row per
    // DR, so that ordering was dead code describing impossible behaviour.
    queryMock.mockResolvedValueOnce(empty);
    await lookupOesGpsByDr('DR100');
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).not.toMatch(/ORDER BY/i);
    expect(sql).toMatch(/LIMIT 1/i);
  });

  it('returns null when nothing matches', async () => {
    queryMock.mockResolvedValueOnce(empty);
    expect(await lookupOesGpsByDr('DR-NONE')).toBeNull();
  });

  it('short-circuits on empty input without touching the database', async () => {
    expect(await lookupOesGpsByDr(null)).toBeNull();
    expect(await lookupOesGpsByDr(undefined)).toBeNull();
    expect(await lookupOesGpsByDr('')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('degrades to null on a DB error rather than breaking ticket creation', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(lookupOesGpsByDr('DR100')).resolves.toBeNull();
  });
});

describe('lookupOesGpsBySerial', () => {
  it('matches case-insensitively on the serial', async () => {
    queryMock.mockResolvedValueOnce(row('-26.5', '27.5'));
    expect(await lookupOesGpsBySerial('alclb48e2002')).toEqual({ latitude: -26.5, longitude: 27.5 });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/LOWER\(serial_number\)\s*=\s*LOWER\(\$1\)/i);
    expect(params?.[0]).toBe('alclb48e2002');
  });

  it('short-circuits on empty input without querying', async () => {
    expect(await lookupOesGpsBySerial(null)).toBeNull();
    expect(await lookupOesGpsBySerial('')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('degrades to null on a DB error', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    await expect(lookupOesGpsBySerial('ALCLB48E0001')).resolves.toBeNull();
  });
});

describe('lookupOesGps — DR first, serial as fallback', () => {
  it('uses the DR hit and never queries the serial', async () => {
    queryMock.mockResolvedValueOnce(row('-26.7387387', '27.0148998'));
    expect(await lookupOesGps('DR100', 'ALCLB48E1001')).toEqual({
      latitude: -26.7387387,
      longitude: 27.0148998,
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the serial when the DR misses — the mismatch case', async () => {
    // A serial-mismatch ticket often has no OES row under the DR it was filed
    // against, because the ONT actually activated somewhere else. The serial is
    // the anchor that survives a wrong DR link.
    queryMock.mockResolvedValueOnce(empty).mockResolvedValueOnce(row('-26.5', '27.5'));
    expect(await lookupOesGps('DR200', 'ALCLB48E2002')).toEqual({ latitude: -26.5, longitude: 27.5 });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect((queryMock.mock.calls[1] as [string, unknown[]])[1]?.[0]).toBe('ALCLB48E2002');
  });

  it('returns null when neither matches', async () => {
    queryMock.mockResolvedValue(empty);
    expect(await lookupOesGps('DR-X', 'ALCLB48EXXXX')).toBeNull();
  });

  it('still tries the serial when no DR is supplied at all', async () => {
    // not_found PP rows have no resolved DR — the serial is the only handle.
    queryMock.mockResolvedValueOnce(row('-26.9', '27.9'));
    expect(await lookupOesGps(null, 'ALCLB48E3003')).toEqual({ latitude: -26.9, longitude: 27.9 });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1]?.[0]).toBe('ALCLB48E3003');
  });

  it('returns null without querying when both handles are absent', async () => {
    expect(await lookupOesGps(null, null)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not let a DR-side DB error suppress the serial fallback path', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(row('-26.4', '27.4'));
    expect(await lookupOesGps('DR400', 'ALCLB48E4004')).toEqual({ latitude: -26.4, longitude: 27.4 });
  });
});

describe('placeholder serials never reach the database', () => {
  it('short-circuits on a placeholder rather than matching an unrelated row', async () => {
    // '-' appears on 50 oes_activations rows across 50 unrelated DRs. An exact
    // LOWER() match would return an arbitrary one — a real, wrong address.
    expect(await lookupOesGpsBySerial('-')).toBeNull();
    expect(await lookupOesGpsBySerial('------')).toBeNull();
    expect(await lookupOesGpsBySerial('N/A')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not fall back to a placeholder serial when the DR misses', async () => {
    // The dangerous path: not_found / empty_serial / wa_no_oes all guarantee a
    // DR miss, which is exactly when the serial fallback runs.
    queryMock.mockResolvedValueOnce(empty);
    expect(await lookupOesGps('DR-MISSING', '-')).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1); // DR attempted, serial refused
  });
});

describe('DR lookup uses the index rather than UPPER()', () => {
  it('uppercases in JS and compares the column directly', async () => {
    queryMock.mockResolvedValueOnce(empty);
    await lookupOesGpsByDr(' dr1734917 ');
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/UPPER\(\s*drop_number/i);
    expect(sql).toMatch(/drop_number = \$1/);
    expect(params?.[0]).toBe('DR1734917');
  });
});
