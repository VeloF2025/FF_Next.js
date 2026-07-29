import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.sql }));
vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: mocks.warn,
    debug: vi.fn(),
  },
}));

import { createSnagsPerPhoto } from '../snag-photo-mapper';

const finding = {
  snagNumber: 1,
  description: 'Pole label is damaged',
  category: 'quality' as const,
};
const photo = { gridIndex: 0, url: '/storage/snag.jpg', filename: 'snag.jpg' };

function sqlText(callIndex: number): string {
  const strings = mocks.sql.mock.calls[callIndex]?.[0] as TemplateStringsArray | undefined;
  return strings ? Array.from(strings).join('?').replace(/\s+/g, ' ') : '';
}

function snag(poleReference: string) {
  return {
    id: 'snag-1',
    project_id: 'project-1',
    pole_ids: null,
    pole_references: [poleReference],
  };
}

function pole(id: string, poleNumber: string) {
  return {
    id,
    pole_number: poleNumber,
    zone_no: null,
    pon_no: null,
    latitude: null,
    longitude: null,
  };
}

async function run(poleReference: string) {
  return createSnagsPerPhoto(
    'report-1',
    'project-1',
    [finding],
    [{ snagNumber: 1, latitude: null, longitude: null, poleReference }],
    [photo],
    'user-1',
  );
}

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.warn.mockReset();
});

describe('createSnagsPerPhoto pole resolution', () => {
  it('prefers an exact full pole-number match without running the suffix fallback', async () => {
    mocks.sql
      .mockResolvedValueOnce([snag('ETW.P.H890')])
      .mockResolvedValueOnce([pole('pole-exact', 'ETW.P.H890')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await run('ETW.P.H890');

    expect(result.snags[0]?.pole_ids).toEqual(['pole-exact']);
    expect(sqlText(1)).toMatch(/UPPER\(TRIM\(pole_number\)\) = UPPER/);
    expect(mocks.sql).toHaveBeenCalledTimes(4);
  });

  it('uses an anchored, deterministic suffix lookup for a short reference', async () => {
    mocks.sql
      .mockResolvedValueOnce([snag('PH890')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pole('pole-1', 'ETW.P.H890')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await run('PH890');

    expect(result.snags[0]?.pole_ids).toEqual(['pole-1']);
    const suffixSql = sqlText(2);
    expect(suffixSql).toMatch(/RIGHT\(\s*UPPER\(TRIM\(pole_number\)\)/);
    expect(suffixSql).toMatch(/ORDER BY[\s\S]*pole_number[\s\S]*\bid/);
    expect(suffixSql).toMatch(/LIMIT 2/);
    expect(suffixSql).not.toMatch(/\bLIKE\b/);
  });

  it('refuses to auto-map an ambiguous suffix and logs both candidates', async () => {
    mocks.sql
      .mockResolvedValueOnce([snag('PH890')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        pole('pole-1', 'ETW.P.H890'),
        pole('pole-2', 'ETW.EXTRA.P.H890'),
      ])
      .mockResolvedValueOnce([]);

    const result = await run('PH890');

    expect(result.snags[0]?.pole_ids).toBeNull();
    expect(result.snags[0]?.pole_references).toEqual(['PH890']);
    expect(mocks.sql).toHaveBeenCalledTimes(4);
    expect(mocks.warn).toHaveBeenCalledWith(
      'SnagPerPhoto: ambiguous pole reference',
      expect.objectContaining({
        projectId: 'project-1',
        reference: 'PH890',
        candidates: ['ETW.P.H890', 'ETW.EXTRA.P.H890'],
      }),
    );
  });
});
