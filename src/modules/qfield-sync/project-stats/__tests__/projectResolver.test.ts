import { describe, expect, it } from 'vitest';
import { resolveProject } from '../projectResolver';
import type { ProjectResolverRepository } from '../projectResolverRepo';

const linked = {
  matchRank: 4,
  fibreflowId: 'ff-mahikeng',
  fibreflowCode: 'PRJ-1782143116953',
  fibreflowName: 'Mahikeng',
  qfieldRegistrationId: 'registration-1',
  qfieldProjectId: 'e801cd43-7efe-4f7a-bed5-ee0410f3dfd6',
  qfieldName: 'HT_Mahikeng',
  qfieldActive: true,
  qfieldLastUpdatedAt: '2026-07-29T11:34:04Z',
};

function repo(rows: (typeof linked)[]): ProjectResolverRepository {
  return { findCandidates: async () => rows };
}

describe('resolveProject', () => {
  it('returns the single active linked project', async () => {
    const result = await resolveProject('Mahikeng', repo([linked]));

    expect(result.qfield.projectId).toBe(linked.qfieldProjectId);
  });

  it('prefers the best match rank before deciding ambiguity', async () => {
    const partial = { ...linked, matchRank: 5, fibreflowId: 'ff-other' };

    expect((await resolveProject('Mahikeng', repo([partial, linked]))).fibreflow.id).toBe(
      'ff-mahikeng'
    );
  });

  it('returns safe candidates when equally ranked active links remain', async () => {
    const second = {
      ...linked,
      fibreflowId: 'ff-two',
      qfieldRegistrationId: 'registration-2',
      qfieldProjectId: 'qf-two',
      qfieldName: 'Mahikeng_Replan_HLD',
    };

    await expect(resolveProject('Mahikeng', repo([linked, second]))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ qfieldName: 'HT_Mahikeng' }),
        ]),
      },
    });
  });

  it('distinguishes a missing project from a missing active QField link', async () => {
    await expect(resolveProject('Unknown', repo([]))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      resolveProject('Mahikeng', repo([{ ...linked, qfieldActive: false }]))
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
