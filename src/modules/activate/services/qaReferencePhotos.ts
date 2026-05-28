/**
 * QA Reference Photos Registry
 *
 * Maps each installation step to example reference images (correct and incorrect)
 * provided by the QA team. Used for visual few-shot prompting in the step
 * quality validation service — the VLM sees real examples alongside the new
 * photo it is evaluating.
 *
 * Reference photos live in: src/modules/activate/services/qa-reference-photos/
 * Loaded server-side via fs.readFileSync at module init, then memoised per step.
 *
 * Registry only contains entries for steps in QUALITY_CHECK_STEPS — adding a new
 * step requires both a registry entry here AND inclusion in QUALITY_CHECK_STEPS
 * in stepQualityCriteria.ts.
 *
 * Step 6 is excluded — handled by ontBackCableValidator, not this service.
 */

import fs from 'fs';
import path from 'path';
import { log } from '@/lib/logger';

const REFS_DIR = path.join(
  process.cwd(),
  'src/modules/activate/services/qa-reference-photos'
);

const MODULE = 'QaReferencePhotos';

interface StepReferenceEntry {
  correct: string[];
  incorrect: Array<{ file: string; reason: string }>;
}

const REGISTRY: Record<number, StepReferenceEntry> = {
  1: {
    correct: ['step-1-correct.png'],
    incorrect: [{ file: 'step-1-incorrect.png', reason: 'Full property not in view — only one wall visible' }],
  },
  2: {
    correct: ['step-2-correct-1.png', 'step-2-correct-2.png'],
    incorrect: [],
  },
  5: {
    correct: ['step-5-correct-1.png', 'step-5-correct-2.png'],
    incorrect: [
      { file: 'step-5-incorrect-1.png', reason: 'No wall mount in view — just a bare worn wall' },
      { file: 'step-5-incorrect-2.png', reason: 'No wall mount in view — just a plain bare wall' },
    ],
  },
  8: {
    correct: ['step-8-correct.png'],
    incorrect: [{ file: 'step-8-incorrect.png', reason: 'Power outlet not in view — close-up of router only' }],
  },
  9: {
    correct: ['step-9-correct.png'],
    incorrect: [{ file: 'step-9-incorrect.png', reason: 'Not all lights in view — only 3 of 4 lights are on' }],
  },
  // Steps 11 & 12 (dome joint open/closed) — reference photos pending; entries
  // intentionally empty so loadStepReferences returns null and the VLM runs
  // zero-shot until field photos are uploaded via the gallery UI.
  11: { correct: [], incorrect: [] },
  12: { correct: [], incorrect: [] },
};

export interface LoadedReference {
  base64: string;
  reason?: string;
}

export interface StepReferences {
  correct: LoadedReference[];
  incorrect: LoadedReference[];
}

// Per-step memo cache. Populated on first call per step.
const CACHE = new Map<number, StepReferences | null>();

/**
 * Load reference images for a given step as base64 strings.
 * Returns null if no references are registered (or all reads failed).
 * Result is memoised per-step — disk is hit at most once per step per process.
 */
export function loadStepReferences(step: number): StepReferences | null {
  const cached = CACHE.get(step);
  if (cached !== undefined) return cached;

  const entry = REGISTRY[step];
  if (!entry) {
    CACHE.set(step, null);
    return null;
  }

  const correct: LoadedReference[] = [];
  for (const filename of entry.correct) {
    const base64 = readImageAsBase64(filename);
    if (base64) correct.push({ base64 });
  }

  const incorrect: LoadedReference[] = [];
  for (const { file, reason } of entry.incorrect) {
    const base64 = readImageAsBase64(file);
    if (base64) incorrect.push({ base64, reason });
  }

  const result = correct.length === 0 && incorrect.length === 0
    ? null
    : { correct, incorrect };
  CACHE.set(step, result);
  return result;
}

function readImageAsBase64(filename: string): string | null {
  const filePath = path.join(REFS_DIR, filename);
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.toString('base64');
  } catch (err) {
    log.warn(`Could not load QA reference photo: ${filename}`, {
      error: err instanceof Error ? err.message : String(err),
    }, MODULE);
    return null;
  }
}
