import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from '../errors';
import { getProjectStats, type ProjectStatsDependencies } from '../projectStatsService';
import { context, dependencies, project, query } from './projectStatsService.fixtures';

afterEach(() => {
  vi.useRealTimers();
});

describe('getProjectStats source orchestration', () => {
  it('requires project resolution before starting source reads', async () => {
    const deps = dependencies();
    const resolutionError = new ProjectStatsError(ErrorCode.NOT_FOUND, 'Project not found');
    vi.mocked(deps.resolveProject).mockRejectedValue(resolutionError);

    await expect(getProjectStats(query, context, deps)).rejects.toBe(resolutionError);
    expect(deps.loadQField).not.toHaveBeenCalled();
    expect(deps.loadFibreFlow).not.toHaveBeenCalled();
  });

  it('routes the external QField UUID and FibreFlow ID to their owning sources', async () => {
    const deps = dependencies();
    deps.loadQField = vi.fn(async (id) => {
      if (id !== 'qf-1') throw new Error('wrong QField project ID');
      return { lastUpdatedAt: '2026-07-29T11:34:04Z', deltas: [] };
    });
    deps.loadFibreFlow = vi.fn(async (id) => {
      if (id !== 'ff-1') throw new Error('wrong FibreFlow project ID');
      return {
        poles: { total: 0, byStatus: {} },
        cables: { total: 0, byStatus: {}, records: new Map() },
        drops: { total: 0, byStatus: {}, qcByStatus: {}, records: new Map() },
        warnings: [],
      };
    });
    for (const load of ['loadQa', 'loadDesign', 'loadPhotoKeys'] as const) {
      const original = deps[load];
      deps[load] = vi.fn(async (id: string, ...args: string[]) => {
        if (id !== 'qf-1') throw new Error('wrong external QField project ID');
        return original(id, ...args);
      }) as ProjectStatsDependencies[typeof load];
    }

    const result = await getProjectStats(query, context, deps);

    expect(result.status).toBe('complete');
    expect(result.project.qfield).toEqual({ id: 'qf-1', name: 'HT_Mahikeng' });
    expect(JSON.stringify(result)).not.toContain('registrationId');
  });

  it('starts all independent sources concurrently after resolution', async () => {
    const deps = dependencies();
    let releaseQa!: () => void;
    let markQaStarted!: () => void;
    const qaStarted = new Promise<void>((resolve) => {
      markQaStarted = resolve;
    });
    deps.loadQa = vi.fn(
      () =>
        new Promise((resolve) => {
          markQaStarted();
          releaseQa = () =>
            resolve({
              total: 0,
              pending: 0,
              inReview: 0,
              approved: 0,
              rejected: 0,
              escalated: 0,
              overdue: 0,
              needsRetake: 0,
              completedRetake: 0,
              myQueue: 0,
              confidence: {},
              byWorkType: {},
              byPriority: {},
            });
        }),
    );

    const pending = getProjectStats(query, context, deps);
    await qaStarted;

    expect(deps.loadQField).toHaveBeenCalledOnce();
    expect(deps.loadFibreFlow).toHaveBeenCalledOnce();
    expect(deps.loadSync).toHaveBeenCalledOnce();
    expect(deps.loadDesign).toHaveBeenCalledOnce();
    expect(deps.loadPhotoKeys).toHaveBeenCalledOnce();
    releaseQa();
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
  });

  it('returns a concise complete summary with system sync scope', async () => {
    const result = await getProjectStats(query, context, dependencies());

    expect(result).toMatchObject({
      status: 'complete',
      section: 'summary',
      project: { qfield: { id: 'qf-1', name: project.qfield.name } },
      freshness: { lastQFieldUpdateAt: '2026-07-29T11:34:04Z' },
      poles: { planted: 0 },
      sync: { scope: 'system' },
      sourceHealth: { qfield: { state: 'ok' } },
      anomalies: null,
    });
    expect(result.warnings).toContain('Sync statistics are system-wide');
  });

  it('returns partial and null for an optional failure without leaking its error', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQa).mockRejectedValue(
      new Error('database password=secret-token raw payload'),
    );

    const result = await getProjectStats(query, context, deps);

    expect(result.status).toBe('partial');
    expect(result.qa).toBeNull();
    expect(result.sourceHealth.qa).toMatchObject({
      state: 'unavailable',
      message: 'qa source unavailable',
    });
    expect(result.warnings).toContain('QA statistics unavailable');
    expect(JSON.stringify(result)).not.toMatch(/secret-token|password=|raw payload/i);
  });

  it('bounds an optional source timeout independently', async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    deps.loadQa = vi.fn(() => new Promise(() => undefined));

    const pending = getProjectStats(query, context, deps);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.status).toBe('partial');
    expect(result.qa).toBeNull();
    expect(result.sourceHealth.qa.state).toBe('timeout');
    expect(result.sourceHealth.qfield.state).toBe('ok');
  });

  it('throws SERVICE_UNAVAILABLE when the primary QField source fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockRejectedValue(new Error('qfield unavailable'));

    await expect(getProjectStats(query, context, deps)).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'QField project statistics are currently unavailable',
      details: { requestId: 'r1' },
    });
  });

  it('throws SERVICE_UNAVAILABLE when the primary QField source times out', async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    deps.loadQField = vi.fn(() => new Promise(() => undefined));

    const pending = getProjectStats(query, context, deps);
    const rejection = expect(pending).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });
});
