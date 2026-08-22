// scripts/vlm-bench/scoring/steps.ts
// Scoring for step-classification packs (categorization, civil-qa).
//
// Both packs ask the VLM "which checklist step is this photo?", so a case is a
// single-label multi-class prediction. Exact-string matching is the wrong tool:
// what matters is whether the predicted step INDEX equals the human's, and
// where the model systematically confuses one step for another.

import type { CaseScore, ScoreOutcome } from '../types';

/** Ground truth stored in a step-classification golden case. */
export interface StepExpectation {
  /** Human-confirmed step index. */
  step: number;
  /** What the model said when the human judged it (null when never run). */
  vlmStepAtReview: number | null;
  /** 'vlm_wrong' cases are human corrections; 'vlm_right' are human confirmations. */
  stratum: 'vlm_wrong' | 'vlm_right';
}

/**
 * Pull the step index out of a VLM reply.
 *
 * Production parses JSON and falls back to text, so the bench must too — a pack
 * that only accepted clean JSON would score malformed-but-correct replies as
 * failures and understate real accuracy.
 */
export function parseStep(actual: string, keys: readonly string[]): number | null {
  const match = actual.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      for (const k of keys) {
        if (!(k in parsed)) continue;
        // The key is present, so this IS the model's answer. Return it — or null
        // if it is not a whole step — rather than falling through to the prose
        // scan, which would re-read the same JSON text and turn 4.5 into "4".
        const v = parsed[k];
        if (typeof v === 'number') return Number.isInteger(v) ? v : null;
        if (typeof v === 'string') return /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null;
        return null;
      }
    } catch {
      // Malformed JSON — fall through to the text scan below.
    }
  }
  // Text fallback: "Step 4", "step_04", "predicted_step: 4".
  const text = actual.match(/step[^0-9-]{0,12}(-?\d{1,2})/i);
  return text ? Number(text[1]) : null;
}

/** Exact step match. No partial credit — a photo filed under the wrong step is simply wrong. */
export function scoreStep(expected: StepExpectation, got: number | null): ScoreOutcome {
  const pass = got !== null && got === expected.step;
  return {
    pass,
    score: pass ? 1 : 0,
    detail: {
      expectedStep: expected.step,
      gotStep: got,
      parsed: got !== null,
      stratum: expected.stratum,
      vlmStepAtReview: expected.vlmStepAtReview,
    },
  };
}

export interface StepMetrics {
  step: number;
  support: number;    // cases whose true label is this step
  predicted: number;  // cases the model assigned to this step
  correct: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Per-step precision/recall over a finished pack run.
 *
 * The engine only aggregates pass/score, so this reads the per-case `detail`
 * the pack wrote. Cases that errored (no detail) are excluded rather than
 * counted as misses — an unreachable GPU is not a classification mistake.
 */
export function stepMetrics(cases: readonly CaseScore[]): StepMetrics[] {
  const support = new Map<number, number>();
  const predicted = new Map<number, number>();
  const correct = new Map<number, number>();
  const bump = (m: Map<number, number>, k: number): void => void m.set(k, (m.get(k) ?? 0) + 1);

  for (const c of cases) {
    const d = c.detail;
    if (!d || typeof d.expectedStep !== 'number') continue;
    const want = d.expectedStep;
    const got = typeof d.gotStep === 'number' ? d.gotStep : null;
    bump(support, want);
    if (got === null) continue; // unparseable reply: counts against recall, not precision
    bump(predicted, got);
    if (got === want) bump(correct, want);
  }

  const steps = [...new Set([...support.keys(), ...predicted.keys()])].sort((a, b) => a - b);
  return steps.map((step) => {
    const s = support.get(step) ?? 0;
    const p = predicted.get(step) ?? 0;
    const c = correct.get(step) ?? 0;
    const precision = p === 0 ? 0 : c / p;
    const recall = s === 0 ? 0 : c / s;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { step, support: s, predicted: p, correct: c, precision, recall, f1 };
  });
}

/** Pass rate split by stratum, so an all-easy sample cannot hide behind one number. */
export function strataBreakdown(cases: readonly CaseScore[]): Record<string, { n: number; passed: number }> {
  const out: Record<string, { n: number; passed: number }> = {};
  for (const c of cases) {
    const stratum = typeof c.detail?.stratum === 'string' ? c.detail.stratum : 'unknown';
    out[stratum] ??= { n: 0, passed: 0 };
    out[stratum].n++;
    if (c.pass) out[stratum].passed++;
  }
  return out;
}
