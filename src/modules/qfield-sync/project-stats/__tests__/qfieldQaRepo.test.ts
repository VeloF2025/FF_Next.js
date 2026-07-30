import { describe, expect, it, vi } from 'vitest';
import { getQaStats } from '../qfieldQaRepo';

describe('getQaStats', () => {
  it('scopes every aggregate to the external QField project and signed-in email', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([
        {
          total: '10',
          pending: '4',
          in_review: '1',
          approved: '3',
          rejected: '2',
          escalated: '0',
          overdue: '1',
          needs_retake: '2',
          completed_retake: '1',
          my_queue: '3',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const value = await getQaStats('external-qfield-project', 'user@example.com', run);

    expect(value.total).toBe(10);
    expect(run.mock.calls[0]?.[1]).toEqual([
      'external-qfield-project',
      'user@example.com',
    ]);
    expect(run.mock.calls.slice(1).map(([, params]) => params)).toEqual([
      ['external-qfield-project'],
      ['external-qfield-project'],
      ['external-qfield-project'],
    ]);
    expect(run.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\bLIMIT\b/i);
    for (const [sql] of run.mock.calls) {
      expect(sql).toContain('FROM qfield_photo_validations');
      expect(sql).toContain('project_id::text = $1');
    }
  });

  it('converts every PostgreSQL count and complete grouped breakdown to numbers', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([
        {
          total: '10',
          pending: '4',
          in_review: '1',
          approved: '3',
          rejected: '2',
          escalated: '0',
          overdue: '1',
          needs_retake: '2',
          completed_retake: '1',
          my_queue: '3',
        },
      ])
      .mockResolvedValueOnce([
        { key: 'high_confidence', count: '6' },
        { key: 'not_validated', count: '4' },
      ])
      .mockResolvedValueOnce([
        { key: 'pole_installation', count: '7' },
        { key: '<null>', count: '3' },
      ])
      .mockResolvedValueOnce([
        { key: 'normal', count: '8' },
        { key: 'urgent', count: '2' },
      ]);

    await expect(
      getQaStats('external-qfield-project', 'user@example.com', run),
    ).resolves.toEqual({
      total: 10,
      pending: 4,
      inReview: 1,
      approved: 3,
      rejected: 2,
      escalated: 0,
      overdue: 1,
      needsRetake: 2,
      completedRetake: 1,
      myQueue: 3,
      confidence: { high_confidence: 6, not_validated: 4 },
      byWorkType: { pole_installation: 7, '<null>': 3 },
      byPriority: { normal: 8, urgent: 2 },
    });
  });

  it('starts the four independent QA aggregates concurrently', async () => {
    let releaseSummary: (rows: Record<string, unknown>[]) => void = () => undefined;
    const summary = new Promise<Record<string, unknown>[]>((resolve) => {
      releaseSummary = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => summary)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const pending = getQaStats('external-qfield-project', 'user@example.com', run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4));
    releaseSummary([]);

    await expect(pending).resolves.toMatchObject({
      total: 0,
      confidence: {},
      byWorkType: {},
      byPriority: {},
    });
  });
});
