// tests/unit/vlm-bench/scoring-steps.test.ts
import { describe, it, expect } from 'vitest';
import { parseStep, scoreStep, stepMetrics, strataBreakdown, type StepExpectation } from '../../../scripts/vlm-bench/scoring/steps';
import type { CaseScore } from '../../../scripts/vlm-bench/types';

const exp = (step: number, stratum: StepExpectation['stratum'] = 'vlm_wrong'): StepExpectation => ({
  step,
  vlmStepAtReview: null,
  stratum,
});

describe('parseStep', () => {
  it('reads the named key out of a JSON reply', () => {
    expect(parseStep('{"classified_step": 4, "valid": true}', ['classified_step'])).toBe(4);
  });
  it('accepts a numeric string, as some replies quote the value', () => {
    expect(parseStep('{"classified_step": "7"}', ['classified_step'])).toBe(7);
  });
  it('honours key priority order', () => {
    expect(parseStep('{"step": 2, "classified_step": 5}', ['classified_step', 'step'])).toBe(5);
  });
  it('preserves step 0 rather than treating it as absent', () => {
    // Step 0 is a real label (Unrelated / Discard); a falsy check would lose it.
    expect(parseStep('{"classified_step": 0}', ['classified_step'])).toBe(0);
  });
  it('falls back to prose when the model skips JSON', () => {
    expect(parseStep('This photo is Step 3 — depth measurement.', ['classified_step'])).toBe(3);
  });
  it('falls back to prose when the JSON is malformed', () => {
    expect(parseStep('{"classified_step": 6,,}  really step 6', ['classified_step'])).toBe(6);
  });
  it('reads a negative step (Duplicate Photo is -1)', () => {
    expect(parseStep('{"predicted_step": -1}', ['predicted_step'])).toBe(-1);
  });
  it('returns null when nothing is parseable', () => {
    expect(parseStep('I cannot tell.', ['classified_step'])).toBeNull();
  });
  it('ignores a non-integer value', () => {
    expect(parseStep('{"classified_step": 4.5}', ['classified_step'])).toBeNull();
  });
});

describe('scoreStep', () => {
  it('passes only on an exact step match', () => {
    expect(scoreStep(exp(4), 4)).toMatchObject({ pass: true, score: 1 });
  });
  it('gives no partial credit to an adjacent step', () => {
    // A photo filed one step off is as wrong as one filed six steps off:
    // downstream coverage flags flip either way.
    expect(scoreStep(exp(4), 5)).toMatchObject({ pass: false, score: 0 });
  });
  it('fails an unparseable reply and records that it could not be parsed', () => {
    const r = scoreStep(exp(4), null);
    expect(r.pass).toBe(false);
    expect(r.detail?.parsed).toBe(false);
  });
  it('carries the stratum through so runs can be split by difficulty', () => {
    expect(scoreStep(exp(1, 'vlm_right'), 1).detail?.stratum).toBe('vlm_right');
  });
});

const c = (id: string, pass: boolean, expectedStep: number, gotStep: number | null, stratum = 'vlm_wrong'): CaseScore => ({
  caseId: id,
  pass,
  score: pass ? 1 : 0,
  detail: { expectedStep, gotStep, stratum },
});

describe('stepMetrics', () => {
  it('computes precision and recall per step', () => {
    // step 4: 2 true, model predicts 4 three times, 1 correct → P=1/3, R=1/2
    const m = stepMetrics([
      c('a', true, 4, 4),
      c('b', false, 4, 5),
      c('c', false, 1, 4),
      c('d', false, 2, 4),
    ]);
    const s4 = m.find((x) => x.step === 4)!;
    expect(s4.support).toBe(2);
    expect(s4.predicted).toBe(3);
    expect(s4.correct).toBe(1);
    expect(s4.precision).toBeCloseTo(1 / 3, 5);
    expect(s4.recall).toBeCloseTo(1 / 2, 5);
    expect(s4.f1).toBeCloseTo(0.4, 5);
  });

  it('charges an unparseable reply to recall but not to precision', () => {
    const m = stepMetrics([c('a', true, 4, 4), c('b', false, 4, null)]);
    const s4 = m.find((x) => x.step === 4)!;
    expect(s4.support).toBe(2);
    expect(s4.predicted).toBe(1);
    expect(s4.recall).toBeCloseTo(0.5, 5);
    expect(s4.precision).toBe(1);
  });

  it('excludes cases that errored rather than scoring them as misses', () => {
    // An unreachable GPU is an infra fault, not a classification mistake.
    const m = stepMetrics([c('a', true, 4, 4), { caseId: 'b', pass: false, score: 0, error: 'VLM HTTP 503' }]);
    expect(m.find((x) => x.step === 4)!.support).toBe(1);
  });

  it('reports a step the model never predicts as recall 0, not as absent', () => {
    const m = stepMetrics([c('a', false, 3, 5)]);
    const s3 = m.find((x) => x.step === 3)!;
    expect(s3.recall).toBe(0);
    expect(s3.f1).toBe(0);
  });
});

describe('strataBreakdown', () => {
  it('splits the pass rate by stratum so an easy sample cannot hide', () => {
    const r = strataBreakdown([
      c('a', true, 1, 1, 'vlm_right'),
      c('b', true, 2, 2, 'vlm_right'),
      c('c', false, 3, 4, 'vlm_wrong'),
    ]);
    expect(r.vlm_right).toEqual({ n: 2, passed: 2 });
    expect(r.vlm_wrong).toEqual({ n: 1, passed: 0 });
  });
});
