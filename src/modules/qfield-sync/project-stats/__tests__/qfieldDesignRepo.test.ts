import { describe, expect, it, vi } from 'vitest';
import { getCachedPoleDesign } from '../qfieldDesignRepo';

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('getCachedPoleDesign', () => {
  it('reads only the latest verified cache row without invoking a resolver', async () => {
    const run = vi.fn().mockResolvedValueOnce([
      {
        gpkg_version: 'v1',
        resolved_at: '2026-07-29T11:34:04Z',
        payload: {
          designPons: [1],
          poleToPon: {
            HT_001: { pon: 1, zone: 'A' },
            HT_002: { pon: 1, zone: 'A' },
          },
        },
      },
    ]);

    await expect(getCachedPoleDesign('qf-1', run)).resolves.toEqual({
      available: true,
      designTotal: 2,
      labels: new Set(['HT_001', 'HT_002']),
      gpkgVersion: 'v1',
      resolvedAt: '2026-07-29T11:34:04Z',
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toEqual(['qf-1']);
    expect(compactSql(run.mock.calls[0]?.[0])).toBe(
      `SELECT gpkg_version, to_char(resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS resolved_at, payload FROM qfield_pole_pon_cache WHERE project_id = $1::uuid ORDER BY resolved_at DESC LIMIT 1`,
    );
    expect(run.mock.calls[0]?.[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('treats a missing cache row as unavailable design data without failing', async () => {
    const run = vi.fn().mockResolvedValueOnce([]);

    await expect(getCachedPoleDesign('qf-1', run)).resolves.toEqual({
      available: false,
      designTotal: null,
      labels: null,
    });
  });

  it.each([
    null,
    {},
    { designPons: [], poleToPon: null },
    { designPons: 'not-an-array', poleToPon: {} },
    { designPons: [], poleToPon: [] },
  ])('rejects malformed cached payload %#', async (payload) => {
    const run = vi.fn().mockResolvedValueOnce([
      { gpkg_version: 'v1', resolved_at: '2026-07-29T11:34:04Z', payload },
    ]);

    await expect(getCachedPoleDesign('qf-1', run)).rejects.toThrow(
      'Malformed QField pole design cache payload',
    );
  });
});
