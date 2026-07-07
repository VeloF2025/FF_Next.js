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
import {
  findEligibleAppealById,
  isAutoDecideEnabled,
  recordAutoDecision,
  recordEvaluation,
  recordTransientFailure,
} from '../appealsVlmStore';
import {
  processAppeal,
  qualifiesForAutoDecision,
  scoreAppealNow,
  toAppealInput,
  toRawBase64,
} from '../appealsVlmRunner';
import type { PendingAppeal } from '../appealsVlmStore';

const mockEvaluate = vi.mocked(evaluateAppeal);
const mockFindById = vi.mocked(findEligibleAppealById);
const mockAutoDecideEnabled = vi.mocked(isAutoDecideEnabled);
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

  it('accepts exactly the 0.80 confidence threshold (boundary)', () => {
    expect(qualifiesForAutoDecision({ ...base, confidence: 0.8 })).toBe(true);
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

  it('NEVER auto-decides a SERIAL appeal (no gallery anchor), even at barcode-level confidence', () => {
    // Serial mode leaves galleryExamplesUsed undefined. Both sides of a serial match are
    // requester-controlled (submitted scan value + submitted photo), so an auto-approve
    // could be fabricated — it must always fall to a human until validated server-side.
    const serial = { ...base, galleryExamplesUsed: undefined };
    expect(qualifiesForAutoDecision(serial)).toBe(false);
    expect(qualifiesForAutoDecision({ ...serial, recommendation: 'approve' })).toBe(false);
  });
});

describe('processAppeal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-decides when the flag is ON and the evaluation qualifies (deny → "denied")', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockAutoDecision.mockResolvedValue(true);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('auto_decided');
    expect(mockAutoDecision).toHaveBeenCalledWith('a1', base, 'denied');
    expect(mockRecordEval).not.toHaveBeenCalled();
  });

  it('maps an approve recommendation to the "approved" decision', async () => {
    mockEvaluate.mockResolvedValue({ ...base, recommendation: 'approve' });
    mockAutoDecision.mockResolvedValue(true);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('auto_decided');
    expect(mockAutoDecision).toHaveBeenCalledWith('a1', expect.objectContaining({ recommendation: 'approve' }), 'approved');
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

  it('reports noop when it loses the claim-once race on an auto-decision', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockAutoDecision.mockResolvedValue(false);
    const outcome = await processAppeal(appeal, true);
    expect(outcome).toBe('noop');
  });

  it('reports noop when it loses the claim-once race on an advisory write', async () => {
    mockEvaluate.mockResolvedValue(base);
    mockRecordEval.mockResolvedValue(false);
    const outcome = await processAppeal(appeal, false);
    expect(outcome).toBe('noop');
  });
});

describe('scoreAppealNow (on-submit fast path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no-ops (never evaluates) when the appeal is no longer eligible', async () => {
    mockFindById.mockResolvedValue(null);
    await scoreAppealNow('a1');
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(mockAutoDecideEnabled).not.toHaveBeenCalled();
  });

  it('scores an eligible appeal, threading the resolved auto-decide flag through', async () => {
    mockFindById.mockResolvedValue(appeal);
    mockAutoDecideEnabled.mockResolvedValue(true);
    mockEvaluate.mockResolvedValue(base); // deny, gallery 6, conf 0.95 → qualifies
    mockAutoDecision.mockResolvedValue(true);
    await scoreAppealNow('a1');
    expect(mockAutoDecideEnabled).toHaveBeenCalledOnce();
    expect(mockAutoDecision).toHaveBeenCalledWith('a1', base, 'denied');
  });

  it('swallows an unexpected error and resolves (the submit request must never fail)', async () => {
    mockFindById.mockRejectedValue(new Error('db down'));
    await expect(scoreAppealNow('a1')).resolves.toBeUndefined();
    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});

describe('toRawBase64', () => {
  it('strips a data-URI prefix, leaving raw base64', () => {
    expect(toRawBase64('data:image/jpeg;base64,AAAA')).toBe('AAAA');
    expect(toRawBase64('data:image/png;base64,ZZZZ')).toBe('ZZZZ');
  });
  it('degrades a null photo to an empty string', () => {
    expect(toRawBase64(null)).toBe('');
  });
  it('leaves an already-raw base64 string untouched', () => {
    expect(toRawBase64('AAAA')).toBe('AAAA');
  });
});

describe('toAppealInput', () => {
  it('maps a pending row to the evaluator input, stripping the data URI', () => {
    expect(toAppealInput(appeal)).toMatchObject({
      jobType: 'activations', stepNumber: 3, photoBase64: 'xxx', appealText: 'outside photo',
    });
  });
  it('defaults a NULL job_type to activations', () => {
    expect(toAppealInput({ ...appeal, job_type: null }).jobType).toBe('activations');
  });
  it('degrades a NULL photo_url to an empty base64 string', () => {
    expect(toAppealInput({ ...appeal, photo_url: null }).photoBase64).toBe('');
  });
});
