/**
 * H&S gate — training now drives the verdict (goal §7.3).
 *
 * With all documents valid, no incidents and a passing overall score, the ONLY
 * variable is the live training rollup. Proves:
 *  - a passing training score leaves can_assign true,
 *  - an expired STATUTORY certificate blocks outright even at a high percentage,
 *  - a sub-70 percentage blocks,
 *  - null (no training data) does not block.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlMock, trainingMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  trainingMock: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('../services/trainingService', () => ({
  computeAndPersistContractorTrainingScore: trainingMock,
}));

import { checkContractorGate } from '../services/gateService';
import type { ContractorTrainingScore } from '../types/training.types';

const COMPLIANCE = {
  contractor_id: 'c1',
  overall_score: 90,
  rag_status: 'green',
  document_score: 90,
  incident_score: 100,
  training_score: null,
  corrective_action_score: 100,
  audit_score: 90,
  next_audit_due: null,
};

const VALID_DOCS = [
  { document_type: 'safety_policy', status: 'valid', expiry_date: null },
  { document_type: 'liability_insurance', status: 'valid', expiry_date: null },
  { document_type: 'safety_plan', status: 'valid', expiry_date: null },
];

function score(overrides: Partial<ContractorTrainingScore>): ContractorTrainingScore {
  return {
    contractor_id: 'c1',
    total_certs: 0,
    current_certs: 0,
    expiring_certs: 0,
    expired_certs: 0,
    expired_statutory_certs: 0,
    training_score: null,
    ...overrides,
  };
}

/** Queue the DB calls the gate makes, in order: compliance, docs, incidents, updateGateStatus. */
function primeSql() {
  sqlMock
    .mockResolvedValueOnce([COMPLIANCE]) // getOrCreateCompliance
    .mockResolvedValueOnce(VALID_DOCS) //   getContractorDocuments
    .mockResolvedValueOnce([]) //           getRecentIncidents
    .mockResolvedValueOnce([]); //          updateGateStatus
}

describe('checkContractorGate — training-driven verdict', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes when training score is healthy', async () => {
    primeSql();
    trainingMock.mockResolvedValueOnce(score({ total_certs: 4, current_certs: 4, training_score: 100 }));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.breakdown.training_score).toBe(100);
  });

  it('blocks on an expired statutory certificate even at a high percentage', async () => {
    primeSql();
    trainingMock.mockResolvedValueOnce(
      score({ total_certs: 10, current_certs: 9, expired_certs: 1, expired_statutory_certs: 1, training_score: 90 })
    );

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(false);
    expect(result.blockers.some((b) => /expired statutory/i.test(b))).toBe(true);
  });

  it('blocks when the training percentage is below the minimum', async () => {
    primeSql();
    trainingMock.mockResolvedValueOnce(score({ total_certs: 4, current_certs: 2, training_score: 50 }));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(false);
    expect(result.blockers.some((b) => /Training compliance \(50%\)/.test(b))).toBe(true);
  });

  it('does not block at exactly the minimum (70% is not below 70%)', async () => {
    primeSql();
    trainingMock.mockResolvedValueOnce(score({ total_certs: 10, current_certs: 7, training_score: 70 }));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.blockers.some((b) => /Training compliance/.test(b))).toBe(false);
  });

  it('does not block when there is no training data (score null)', async () => {
    primeSql();
    trainingMock.mockResolvedValueOnce(score({ training_score: null }));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.blockers.some((b) => /training/i.test(b))).toBe(false);
  });
});
