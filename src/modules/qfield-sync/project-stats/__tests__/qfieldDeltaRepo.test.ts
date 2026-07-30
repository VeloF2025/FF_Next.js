import { beforeEach, describe, expect, it, vi } from 'vitest';

const { qfcQuery } = vi.hoisted(() => ({ qfcQuery: vi.fn() }));
vi.mock('../../../../lib/qfieldcloud/qfcPool', () => ({ qfcQuery }));

import { qfieldDeltaRepo } from '../qfieldDeltaRepo';

describe('qfieldDeltaRepo', () => {
  beforeEach(() => qfcQuery.mockReset());

  it('projects authoritative delta fields using parameterized core_project and core_delta queries', async () => {
    qfcQuery.mockResolvedValueOnce([{ updated_at: '2026-07-29T11:34:04Z' }]).mockResolvedValueOnce([
      {
        id: 'd1',
        feature_key: '42',
        label: 'HT_MFKGP4_F001',
        status: ' Pole Planted - Photos Incomplete ',
        last_status: 'applied',
        created_at: '2026-07-29T10:00:00Z',
        drop_number: null,
        cable_id: null,
        cable_length_m: null,
        installation_status: null,
        qc_status: null,
        photo_keys: ['DCIM/a.jpg'],
      },
    ]);

    const result = await qfieldDeltaRepo.load('qfield-project');

    expect(result).toEqual({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [{
        id: 'd1', featureKey: '42', label: 'HT_MFKGP4_F001',
        status: 'Pole Planted - Photos Incomplete', lastStatus: 'applied',
        createdAt: '2026-07-29T10:00:00Z', dropNumber: null, cableId: null,
        cableLengthM: null, installationStatus: null, qcStatus: null,
        photoKeys: ['DCIM/a.jpg'],
      }],
    });
    expect(qfcQuery.mock.calls.map(([, params]) => params)).toEqual([
      ['qfield-project'], ['qfield-project'],
    ]);
    const sqlText = qfcQuery.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).toContain('core_project');
    expect(sqlText).toContain('core_delta');
    expect(sqlText).not.toMatch(/core_(layer|feature)/);
    expect(sqlText).toContain("d.content->'new'->'attributes'");
    expect(sqlText).toContain("d.content->'old'->'attributes'");
  });

  it('normalizes old-only values and excludes missing localPk rows', async () => {
    qfcQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'old-only',
        feature_key: '42',
        label: 'OLD_LABEL',
        status: ' Old Status ',
        last_status: 'applied',
        created_at: '2026-07-29T10:00:00Z',
        drop_number: 'DR-1',
        cable_id: 'C-1',
        cable_length_m: '12.5',
        installation_status: ' Installed ',
        qc_status: ' Approved ',
        photo_keys: [],
      },
      {
        id: 'missing-key',
        feature_key: null,
        label: 'IGNORED',
        status: 'Pole Planted/ All Photos',
        last_status: 'applied',
        created_at: '2026-07-29T11:00:00Z',
        drop_number: null,
        cable_id: null,
        cable_length_m: null,
        installation_status: null,
        qc_status: null,
        photo_keys: [],
      },
    ]);

    const result = await qfieldDeltaRepo.load('qfield-project');

    expect(result.deltas).toEqual([
      expect.objectContaining({
        id: 'old-only',
        featureKey: '42',
        label: 'OLD_LABEL',
        status: 'Old Status',
        dropNumber: 'DR-1',
        cableId: 'C-1',
        cableLengthM: 12.5,
        installationStatus: 'Installed',
        qcStatus: 'Approved',
      }),
    ]);
  });

  it.each([
    ['', null],
    ['   ', null],
    ['not-a-number', null],
    ['Infinity', null],
    [Infinity, null],
    ['0', 0],
  ])('maps cable length %j to %j', async (cableLength, expected) => {
    qfcQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'd1',
        feature_key: '42',
        label: null,
        status: 'String Complete',
        last_status: 'applied',
        created_at: '2026-07-29T10:00:00Z',
        drop_number: null,
        cable_id: 'C-1',
        cable_length_m: cableLength,
        installation_status: null,
        qc_status: null,
        photo_keys: [],
      },
    ]);

    const result = await qfieldDeltaRepo.load('qfield-project');

    expect(result.deltas[0]?.cableLengthM).toBe(expected);
  });
});
