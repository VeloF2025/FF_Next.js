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
});
