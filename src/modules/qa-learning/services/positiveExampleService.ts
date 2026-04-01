/**
 * Positive Example Service
 *
 * Selects and formats confirmed-correct examples for VLM prompt injection.
 * Complements the existing few-shot correction service by providing
 * positive reinforcement — what the VLM got RIGHT.
 */

import { log } from '@/lib/logger';
import type { WorkflowType, PositiveExample } from '../types/learning.types';
import { confirmedToPositiveExample } from '../types/learning.types';
import { getConfirmedCorrect } from './confirmedCorrectService';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_EXAMPLES = 3;
const DEFAULT_MIN_CONFIDENCE = 0.9;

// ============================================================================
// TYPES
// ============================================================================

export interface PositiveExampleOptions {
  workflowType: WorkflowType;
  maxExamples?: number;
  minConfidence?: number;
  canonicalOnly?: boolean;
}

export interface PositiveExampleResult {
  examples: PositiveExample[];
  totalAvailable: number;
}

// ============================================================================
// SELECTION
// ============================================================================

/**
 * Get positive examples for VLM prompt injection.
 * Only includes high-confidence photos that humans confirmed as correct.
 */
export async function getPositiveExamples(
  options: PositiveExampleOptions
): Promise<PositiveExampleResult> {
  const {
    workflowType,
    maxExamples = DEFAULT_MAX_EXAMPLES,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    canonicalOnly = false,
  } = options;

  try {
    const records = await getConfirmedCorrect(workflowType, {
      limit: maxExamples,
      minConfidence,
      canonicalOnly,
    });

    // Deduplicate by step — at most one example per step for diversity
    const seenSteps = new Set<number>();
    const examples: PositiveExample[] = [];

    for (const record of records) {
      if (!seenSteps.has(record.vlmPredictedStep) && examples.length < maxExamples) {
        examples.push(confirmedToPositiveExample(record));
        seenSteps.add(record.vlmPredictedStep);
      }
    }

    log.debug('PositiveExampleService', {
      action: 'getPositiveExamples',
      workflowType,
      selected: examples.length,
      totalFetched: records.length,
    });

    return { examples, totalAvailable: records.length };
  } catch (error) {
    log.error('PositiveExampleService', {
      action: 'getPositiveExamples',
      workflowType,
      error: error instanceof Error ? error.message : String(error),
    });
    return { examples: [], totalAvailable: 0 };
  }
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

/**
 * Build a prompt section from positive examples.
 * Injected into the VLM categorization prompt alongside correction examples.
 */
export function buildPositiveExamplesPromptSection(examples: PositiveExample[]): string {
  if (examples.length === 0) return '';

  let section = `\n\nCONFIRMED CORRECT CLASSIFICATIONS:\n`;
  section += `The following examples show correct classifications verified by human reviewers:\n\n`;

  examples.forEach((ex, i) => {
    section += `Example ${i + 1}:\n`;
    section += `- Photo showed: "${ex.photoDescription}"\n`;
    section += `- CORRECT classification: Step ${ex.step} (${ex.category})\n`;
    section += `- Confidence: ${Math.round(ex.confidence * 100)}%\n\n`;
  });

  return section;
}
