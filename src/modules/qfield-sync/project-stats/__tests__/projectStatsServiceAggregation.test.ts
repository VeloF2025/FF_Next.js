import { describe, expect, it, vi } from 'vitest';
import { getProjectStats } from '../projectStatsService';
import {
  baseDelta,
  context,
  dependencies,
  qfieldCable,
  qfieldDrop,
  query,
} from './projectStatsService.fixtures';

describe('getProjectStats aggregation', () => {
  it('keeps planting independent when MinIO and QA fail', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        {
          ...baseDelta('pole-1', 'Pole Planted/ All Photos'),
          photoKeys: ['DCIM/pole-1.jpg'],
        },
      ],
    });
    vi.mocked(deps.loadPhotoKeys).mockRejectedValue(new Error('minio unavailable'));
    vi.mocked(deps.loadQa).mockRejectedValue(new Error('qa unavailable'));

    const result = await getProjectStats(query, context, deps);

    expect(result.poles).toMatchObject({
      planted: 1,
      referencedPhotos: 1,
      presentPhotos: null,
      missingPhotos: null,
    });
    expect(result.sourceHealth.minio.state).toBe('unavailable');
  });

  it('reports genuine missing photos only after MinIO answers successfully', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        {
          ...baseDelta('pole-1', 'Pole Planted/ All Photos'),
          photoKeys: ['DCIM/pole-1.jpg'],
        },
      ],
    });

    const result = await getProjectStats(query, context, deps);

    expect(result.poles).toMatchObject({
      referencedPhotos: 1,
      presentPhotos: 0,
      missingPhotos: 1,
    });
    expect(result.sourceHealth.minio.state).toBe('ok');
  });

  it('reconciles normalized cable and drop records without serializing maps', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        qfieldCable(' C-1 ', ' String Complete '),
        qfieldCable('C-2', 'String Issue'),
        qfieldDrop(' DR-1 ', ' Installed ', ' Approved '),
      ],
    });
    vi.mocked(deps.loadFibreFlow).mockResolvedValue({
      poles: { total: 0, byStatus: {} },
      cables: {
        total: 2,
        byStatus: { complete: 1, planned: 1 },
        records: new Map([
          ['c-1', { status: 'string complete' }],
          ['c-3', { status: 'planned' }],
        ]),
      },
      drops: {
        total: 1,
        byStatus: { Installed: 1 },
        qcByStatus: { Pending: 1 },
        records: new Map([
          ['dr-1', { installationStatus: 'installed', qcStatus: 'Pending' }],
        ]),
      },
      warnings: [],
    });

    const result = await getProjectStats(query, context, deps);

    expect(result.cables).toMatchObject({
      synchronized: 1,
      needsSync: 0,
      qfieldOnly: 1,
      fibreflowOnly: 1,
    });
    expect(result.drops).toMatchObject({
      synchronized: 0,
      needsSync: 1,
      qfieldOnly: 0,
      fibreflowOnly: 0,
    });
    expect(JSON.stringify(result)).not.toContain('"records":');
  });

  it('computes design coverage by normalized labels', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [baseDelta('pole-1', 'Pole Planted/ All Photos')],
    });
    vi.mocked(deps.loadDesign).mockResolvedValue({
      available: true,
      designTotal: 999,
      labels: new Set([' POLE-1 ', 'pole-2']),
    });

    const result = await getProjectStats(query, context, deps);

    expect(result.poles).toMatchObject({ designTotal: 2, neverCaptured: 1 });
  });

  it('warns when a planted pole lacks a recognized photo state', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [baseDelta('pole-1', 'Pole Verified/ Civil Complete')],
    });

    const result = await getProjectStats(query, context, deps);

    expect(result.poles).toMatchObject({
      planted: 1,
      photoComplete: 0,
      photoIncomplete: 0,
    });
    expect(result.warnings).toContain(
      '1 planted pole lacks a recognized photo state',
    );
  });

  it('paginates only sorted anomaly details while preserving the full total', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: ['e', 'd', 'c', 'b', 'a'].map((identity, index) => ({
        ...baseDelta(identity, 'Pole Planted/ All Photos'),
        id: identity,
        lastStatus: 'error' as const,
        createdAt: `2026-07-29T10:0${index}:00Z`,
      })),
    });

    const result = await getProjectStats(
      { ...query, section: 'anomalies', page: 2, limit: 2 },
      context,
      deps,
    );

    expect(result.anomalies).toMatchObject({
      total: 5,
      page: 2,
      limit: 2,
      items: [{ featureKey: 'c' }, { featureKey: 'b' }],
    });
    expect(result.poles).toBeNull();
    expect(result.cables).toBeNull();
  });

  it('keeps section totals identical and hides unrelated sections', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [baseDelta('pole-1', 'Pole Planted - Photos Incomplete')],
    });

    const summary = await getProjectStats(query, context, deps);
    const poles = await getProjectStats({ ...query, section: 'poles' }, context, deps);

    expect(poles.poles).toEqual(summary.poles);
    expect(poles.cables).toBeNull();
    expect(poles.drops).toBeNull();
    expect(poles.qa).toBeNull();
    expect(poles.sync).toBeNull();
    expect(JSON.stringify(poles)).not.toMatch(
      /customer|address|geometry|authorization|token/i,
    );
  });

  it('uses the weekday freshness policy and concise unknown-status warnings', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-28T06:00:00Z',
      deltas: [baseDelta('pole-1', 'Pole Unexpected')],
    });

    const result = await getProjectStats(query, context, deps);

    expect(result.freshness).toMatchObject({
      state: 'stale',
      warningSuppressed: false,
      weekdayAgeHours: 50,
    });
    expect(result.warnings).toContain('QField data is stale');
    expect(result.warnings).toContain('1 QField record has an unknown status');
  });
});
