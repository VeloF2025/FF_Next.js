import { describe, expect, it, vi } from 'vitest';
import { getFibreFlowInfrastructure } from '../fibreflowInfrastructureRepo';

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('getFibreFlowInfrastructure', () => {
  it('runs exact field-limited parameterized queries without hard limits', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([{ status: 'installed', count: '240' }])
      .mockResolvedValueOnce([
        { identity: 'c-1', status: 'complete' },
        { identity: 'c-2', status: 'issue' },
      ])
      .mockResolvedValueOnce([
        { identity: 'dr-1', status: 'installed', qc_status: 'approved' },
      ]);

    await getFibreFlowInfrastructure('ff-project', run);

    expect(run.mock.calls.map(([sql]) => compactSql(sql))).toEqual([
      "SELECT COALESCE(status, '<null>') AS status, COUNT(*)::int AS count FROM poles WHERE project_id = $1::uuid GROUP BY status",
      "SELECT lower(trim(segment_id)) AS identity, NULLIF(trim(status), '') AS status FROM fibre_segments WHERE project_id = $1::uuid",
      "SELECT lower(trim(drop_number)) AS identity, NULLIF(trim(status), '') AS status, NULLIF(trim(qc_status), '') AS qc_status FROM drops WHERE project_id = $1::uuid",
    ]);
    expect(run.mock.calls.map(([, params]) => params)).toEqual([
      ['ff-project'],
      ['ff-project'],
      ['ff-project'],
    ]);
    expect(run.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\bLIMIT\b/i);
  });

  it('loads all comparison rows and preserves complete status distributions', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([
        { status: 'installed', count: '240' },
        { status: '<null>', count: 2 },
      ])
      .mockResolvedValueOnce([
        { identity: ' C-1 ', status: 'complete' },
        { identity: 'c-2', status: 'issue' },
        { identity: '', status: null },
      ])
      .mockResolvedValueOnce([
        { identity: ' DR-1 ', status: 'installed', qc_status: 'approved' },
        { identity: 'dr-2', status: null, qc_status: 'pending' },
      ]);

    const result = await getFibreFlowInfrastructure('ff-project', run);

    expect(result.poles).toEqual({
      total: 242,
      byStatus: { installed: 240, '<null>': 2 },
    });
    expect(result.cables.total).toBe(3);
    expect(result.cables.byStatus).toEqual({ complete: 1, issue: 1, '<null>': 1 });
    expect(result.cables.records).toEqual(
      new Map([
        ['c-1', { status: 'complete' }],
        ['c-2', { status: 'issue' }],
      ]),
    );
    expect(result.drops.total).toBe(2);
    expect(result.drops.byStatus).toEqual({ installed: 1, '<null>': 1 });
    expect(result.drops.qcByStatus).toEqual({ approved: 1, pending: 1 });
    expect(result.drops.records.get('dr-1')).toEqual({
      installationStatus: 'installed',
      qcStatus: 'approved',
    });
  });

  it('starts the three independent database reads concurrently', async () => {
    let releasePoles: (rows: Record<string, unknown>[]) => void = () => undefined;
    const poles = new Promise<Record<string, unknown>[]>((resolve) => {
      releasePoles = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => poles)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const pending = getFibreFlowInfrastructure('ff-project', run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    releasePoles([]);

    await expect(pending).resolves.toMatchObject({
      poles: { total: 0 },
      cables: { total: 0 },
      drops: { total: 0 },
    });
  });
});
