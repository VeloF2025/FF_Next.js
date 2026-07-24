/**
 * H&S training service — contractor training score rollup.
 *
 * Guards the arithmetic and the NULL-means-no-data semantics the gate relies on:
 * an absent training population must NOT block (score null), while any current /
 * expired split must produce the right percentage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

import {
  computeContractorTrainingScore,
  computeAndPersistContractorTrainingScore,
} from '../services/trainingService';

describe('computeContractorTrainingScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null score when the contractor has no training data (does not block)', async () => {
    sqlMock.mockResolvedValueOnce([
      { total_certs: 0, current_certs: 0, expiring_certs: 0, expired_certs: 0, expired_statutory_certs: 0 },
    ]);

    const score = await computeContractorTrainingScore('c1');
    expect(score.total_certs).toBe(0);
    expect(score.training_score).toBeNull();
  });

  it('computes a rounded percentage of current over total', async () => {
    sqlMock.mockResolvedValueOnce([
      { total_certs: 2, current_certs: 1, expiring_certs: 0, expired_certs: 1, expired_statutory_certs: 1 },
    ]);

    const score = await computeContractorTrainingScore('c1');
    expect(score.training_score).toBe(50);
    expect(score.expired_statutory_certs).toBe(1);
  });

  it('rounds to the nearest integer', async () => {
    sqlMock.mockResolvedValueOnce([
      { total_certs: 3, current_certs: 2, expiring_certs: 0, expired_certs: 1, expired_statutory_certs: 0 },
    ]);

    const score = await computeContractorTrainingScore('c1');
    expect(score.training_score).toBe(67); // 66.67 -> 67
  });
});

describe('computeAndPersistContractorTrainingScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the score and still returns it even if the UPDATE throws', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { total_certs: 4, current_certs: 4, expiring_certs: 0, expired_certs: 0, expired_statutory_certs: 0 },
      ])
      .mockRejectedValueOnce(new Error('write failed'));

    const score = await computeAndPersistContractorTrainingScore('c1');
    expect(score.training_score).toBe(100);
    // two sql calls: the aggregate + the (failing) persist
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
