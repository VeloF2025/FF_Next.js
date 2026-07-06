vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../appealsVlmService', () => ({ evaluateAppeal: vi.fn() }));
vi.mock('../appealsVlmStore', () => ({
  findEligibleAppealById: vi.fn(),
  isAutoDecideEnabled: vi.fn(),
  recordAutoDecision: vi.fn(),
  recordEvaluation: vi.fn(),
  recordTransientFailure: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateAppeal, type AppealEvaluation } from '../appealsVlmService';
import { recordAutoDecision, recordEvaluation, recordTransientFailure } from '../appealsVlmStore';
import { processAppeal, qualifiesForAutoDecision } from '../appealsVlmRunner';
import type { PendingAppeal } from '../appealsVlmStore';

const mockEvaluate = vi.mocked(evaluateAppeal);
const mockAutoDecision = vi.mocked(recordAutoDecision);
const mockRecordEval = vi.mocked(recordEvaluation);
const mockTransient = vi.mocked(recordTransientFailure);

const appeal: PendingAppeal = {
  id: 'a1', dr_number: 'DR1', step_number: 3, job_type: 'activations',
  photo_url: 'data:image/jpeg;base64,xxx', appeal_text: 'outside photo',
  serial_scanned: null, serial_expected: null,
};

const base: AppealEvaluation = {
  recommendation: 'deny', confidence: 0.95, reasoning: 'no cable entry',
  checks: [], serialRead: null, model: 'qwen/appeal-v1', skipReason: null,
  galleryExamplesUsed: 6,
};

describe('qualifiesForAutoDecision', () => {
  it('accepts a confident approve/deny that was cross-referenced against the gallery', () => {
    expect(qualifiesForAutoDecision({ ...base, recommendation: 'deny' })).toBe(true);
    expect(qualifiesForAutoDecision({ ...base, recommendation: 'approve' })).toBe(true);
  });

  it('rejects uncertain', () => {
    expect(qualifiesForAutoDecision({ ...base, recommendation: 'uncertain' })).toBe(false);
  });

  it('rejects below the 0.80 confidence threshold', () => {
    expect(qualifiesForAutoDecision({ ...base, confidence: 0.79 })).toBe(false);
  });

  it('rejects a PHOTO appeal that was NOT cross-referenced against any gallery example', () => {
    expect(qualifiesForAutoDecision({ ...base, galleryExamplesUsed: 0 })).toBe(false);
  });

  it('allows a SERIAL appeal (no gallery) on confidence alone', () => {
    const serial = { ...base, galleryExamplesUsed: undefined };
    expect(qualifiesForAutoDecision(serial)).toBe(true);
  });
});

describe('processAppeal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-decides when the flag is ON and the evaluation qualifies', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockAutoDecision.mockResolvedValue(true);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('auto_decided');
    expect(mockAutoDecision).toHaveBeenCalledWith('a1', base, 'denied');
    expect(mockRecordEval).not.toHaveBeenCalled();
  });

  it('stays advisory (never auto-decides) when the flag is OFF, even for a confident result', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockRecordEval.mockResolvedValue(true);
    const outcome = await processAppeal(appeal, false);
    expect(outcome).toBe('scored');
    expect(mockAutoDecision).not.toHaveBeenCalled();
    expect(mockRecordEval).toHaveBeenCalled();
  });

  it('falls back to advisory for an uncertain result even with the flag ON', async () => {
    mockEvaluate.mockResolvedValue({ ...base, recommendation: 'uncertain', skipReason: 'unsupported_step' });
    mockRecordEval.mockResolvedValue(true);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('scored');
    expect(mockAutoDecision).not.toHaveBeenCalled();
  });

  it('retries on a transient VLM outage, never records a decision', async () => {
    mockEvaluate.mockResolvedValue({ ...base, recommendation: 'uncertain', skipReason: 'vlm_unavailable' });
    mockTransient.mockResolvedValue({ attempts: 1, parked: false });
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('retried');
    expect(mockAutoDecision).not.toHaveBeenCalled();
    expect(mockRecordEval).not.toHaveBeenCalled();
  });

  it('reports noop when it loses the claim-once race', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockAutoDecision.mockResolvedValue(false);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('noop');
  });
});
