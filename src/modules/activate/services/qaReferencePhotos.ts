/**
 * QA Reference Photos Registry
 *
 * Maps each installation step to example reference images (correct and incorrect)
 * provided by the QA team. These are used for visual few-shot prompting in the
 * step quality validation service — the VLM sees real examples alongside the
 * new photo it is evaluating.
 *
 * Reference photos live in: src/modules/activate/services/qa-reference-photos/
 * They are loaded server-side via fs.readFileSync (API route context only).
 *
 * To update examples: replace the PNG files in qa-reference-photos/ and update
 * the registry below if the filenames change.
 *
 * Last updated: 2026-05-19
 */

import fs from 'fs';
import path from 'path';
import { log } from '@/lib/logger';

const REFS_DIR = path.join(
  process.cwd(),
  'src/modules/activate/services/qa-reference-photos'
);

const MODULE = 'QaReferencePhotos';

// ============================================================================
// REGISTRY
// ============================================================================

interface StepReferenceEntry {
  correct: string[];
  incorrect: Array<{ file: string; reason: string }>;
}

/**
 * Per-step reference photo registry.
 * Steps 3 and 4 share cross-reference examples to reinforce inside/outside distinction.
 * Step 6 is excluded — handled by ontBackCableValidator, not stepQualityValidationService.
 */
const REGISTRY: Record<number, StepReferenceEntry> = {
  1: {
    correct: ['step-1-correct.png'],
    incorrect: [{ file: 'step-1-incorrect.png', reason: 'Full property not in view — only one wall visible' }],
  },
  2: {
    correct: ['step-2-correct-1.png', 'step-2-correct-2.png'],
    incorrect: [],
  },
  3: {
    correct: ['step-3-correct-1.png', 'step-3-correct-2.png'],
    incorrect: [],
  },
  4: {
    correct: ['step-4-correct-1.png', 'step-4-correct-2.png'],
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
  11: {
    correct: ['step-11-correct-1.png', 'step-11-correct-2.png'],
    incorrect: [],
  },
  12: {
    correct: ['step-12-correct-1.png', 'step-12-correct-2.png'],
    incorrect: [],
  },
};

// ============================================================================
// LOADER
// ============================================================================

export interface LoadedReference {
  base64: string;
  reason?: string;
}

export interface StepReferences {
  correct: LoadedReference[];
  incorrect: LoadedReference[];
}

/**
 * Load reference images for a given step as base64 strings.
 * Returns null if no references are registered for that step.
 * Individual images that fail to load are skipped with a warning (non-fatal).
 */
export function loadStepReferences(step: number): StepReferences | null {
  const entry = REGISTRY[step];
  if (!entry) return null;

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

  if (correct.length === 0 && incorrect.length === 0) return null;
  return { correct, incorrect };
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
