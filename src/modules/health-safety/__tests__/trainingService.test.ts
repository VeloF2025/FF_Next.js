/**
 * H&S training service — contractor training score rollup.
 *
 * Guards the arithmetic and the NULL-means-no-data semantics the gate relies on:
 * an absent training population must NOT block (score null), while any current /
 * expired split must produce the right percentage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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

describe('only verified evidence counts', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Asserted against the emitted SQL rather than through fixtures, because the
   * driver is mocked here: the exclusion happens in Postgres, so a JS-level
   * fixture would only re-test the mock. The behaviour itself is proven on dev
   * against the real database (goal §6.4).
   */
  function emittedSql(): string {
    const call = sqlMock.mock.calls[0];
    return (call[0] as unknown as string[]).join(' ? ');
  }

  it('filters the rollup to verified rows', async () => {
    sqlMock.mockResolvedValueOnce([
      { total_certs: 0, current_certs: 0, expiring_certs: 0, expired_certs: 0, expired_statutory_certs: 0 },
    ]);
    await computeContractorTrainingScore('c1');
    // Pending, rejected and revoked evidence must not reach the arithmetic at
    // all — not be counted and then subtracted.
    expect(emittedSql()).toMatch(/wt\.verification_status = 'verified'/);
  });

  it('a population of only unverified rows scores null, which does not block', async () => {
    // total_certs 0 because the WHERE excluded every pending row.
    sqlMock.mockResolvedValueOnce([
      { total_certs: 0, current_certs: 0, expiring_certs: 0, expired_certs: 0, expired_statutory_certs: 0 },
    ]);
    const score = await computeContractorTrainingScore('c1');
    expect(score.training_score).toBeNull();
  });

  it('the project competency matrix resolves cells from verified rows only', async () => {
    // Source assertion, for the same reason as above: the filter lives in SQL.
    // A worker with only pending evidence must read as 'missing', not current.
    const matrix = readFileSync(
      join(process.cwd(), 'pages/api/health-safety/training/competency.ts'),
      'utf8'
    );
    expect(matrix).toMatch(/w\.verification_status = 'verified'/);
  });

  it('an expired but verified statutory certificate still counts as expired evidence', async () => {
    sqlMock.mockResolvedValueOnce([
      { total_certs: 1, current_certs: 0, expiring_certs: 0, expired_certs: 1, expired_statutory_certs: 1 },
    ]);
    const score = await computeContractorTrainingScore('c1');
    expect(score.training_score).toBe(0);
    expect(score.expired_statutory_certs).toBe(1);
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
