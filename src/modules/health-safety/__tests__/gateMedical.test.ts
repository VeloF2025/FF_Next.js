/**
 * H&S gate — per-worker medical fitness drives the verdict (audit rec #3).
 *
 * With all documents valid, no incidents, a passing overall score and a healthy
 * training rollup, the ONLY variable is the medical summary. Proves:
 *  - a clean medical position leaves can_assign true,
 *  - a worker on file as UNFIT blocks outright,
 *  - a lapsed Certificate of Fitness blocks outright,
 *  - expiring-soon and fit-with-restriction warn but do not block,
 *  - no medical data at all does not block (absence != non-compliance).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlMock, trainingMock, medicalMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  trainingMock: vi.fn(),
  medicalMock: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('../services/trainingService', () => ({
  computeAndPersistContractorTrainingScore: trainingMock,
}));

vi.mock('../services/medicalService', () => ({
  computeContractorMedicalSummary: medicalMock,
}));

import { checkContractorGate } from '../services/gateService';
import type { ContractorMedicalSummary } from '../types/medical.types';

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

const HEALTHY_TRAINING = {
  contractor_id: 'c1',
  total_certs: 4,
  current_certs: 4,
  expiring_certs: 0,
  expired_certs: 0,
  expired_statutory_certs: 0,
  training_score: 100,
};

function medical(overrides: Partial<ContractorMedicalSummary>): ContractorMedicalSummary {
  return {
    contractor_id: 'c1',
    workers_with_medicals: 0,
    current: 0,
    expiring_soon: 0,
    expired: 0,
    unfit: 0,
    restricted: 0,
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
  trainingMock.mockResolvedValueOnce(HEALTHY_TRAINING);
}

describe('checkContractorGate — medical-fitness-driven verdict', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes when every worker is fit with a current certificate', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(medical({ workers_with_medicals: 5, current: 5 }));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks when a worker is medically unfit', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(
      medical({ workers_with_medicals: 5, current: 5, unfit: 1 })
    );

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(false);
    expect(result.blockers.some((b) => /1 worker\(s\) medically unfit/.test(b))).toBe(true);
  });

  it('blocks on a lapsed Certificate of Fitness', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(
      medical({ workers_with_medicals: 5, current: 3, expired: 2 })
    );

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(false);
    expect(result.blockers.some((b) => /2 expired medical certificate\(s\)/.test(b))).toBe(true);
  });

  it('warns but does not block on certificates expiring soon', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(
      medical({ workers_with_medicals: 5, current: 5, expiring_soon: 2 })
    );

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.warnings.some((w) => /2 medical certificate\(s\) expiring soon/.test(w))).toBe(
      true
    );
  });

  it('warns but does not block when a worker is fit only with restrictions', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(
      medical({ workers_with_medicals: 5, current: 5, restricted: 1 })
    );

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.warnings.some((w) => /fit with restrictions/.test(w))).toBe(true);
  });

  it('does not block when there is no medical data at all', async () => {
    primeSql();
    medicalMock.mockResolvedValueOnce(medical({}));

    const result = await checkContractorGate('c1');
    expect(result.can_assign).toBe(true);
    expect(result.blockers.some((b) => /medical/i.test(b))).toBe(false);
  });
});
