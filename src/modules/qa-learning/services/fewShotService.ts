/**
 * Few-Shot Service
 *
 * Purpose: Select optimal few-shot examples for VLM prompt enhancement
 * Strategy: Prioritize canonical > confusion pairs > high-confidence mistakes > recent
 *
 * WORKING: Phase 1 implementation
 */

import { log } from '@/lib/logger';
import db from '@/lib/db';
import {
  WorkflowType,
  FewShotExample,
  FewShotSelectionOptions,
  FewShotSelectionResult,
  CorrectionRecord,
  CorrectionRecordRow,
  rowToCorrectionRecord,
  correctionToFewShot,
  getConfusionPairs,
} from '../types/learning.types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_EXAMPLES = 5;
const DEFAULT_MIN_CONFIDENCE_FOR_MISTAKE = 0.8;
const RECENT_DAYS_THRESHOLD = 30;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Get relevant few-shot examples for VLM prompt
 *
 * Selection strategy (in priority order):
 * 1. Canonical examples - Manually curated high-quality corrections
 * 2. Confusion pair examples - For commonly confused step pairs
 * 3. High-confidence mistakes - Where VLM was confident but wrong
 * 4. Recent corrections - Fresh corrections from last 30 days
 *
 * @param options - Selection options
 * @returns Selected examples with metadata
 */
export async function getRelevantExamples(
  options: FewShotSelectionOptions
): Promise<FewShotSelectionResult> {
  const {
    workflowType,
    maxExamples = DEFAULT_MAX_EXAMPLES,
    includeConfusionPairs = true,
    canonicalOnly = false,
    minConfidenceForMistake = DEFAULT_MIN_CONFIDENCE_FOR_MISTAKE,
  } = options;

  const startTime = Date.now();
  const selectionCriteria: string[] = [];
  const selectedExamples: FewShotExample[] = [];
  const usedIds = new Set<string>();

  try {
    // If canonical only, just get canonical examples
    if (canonicalOnly) {
      const canonical = await getCanonicalExamples(workflowType, maxExamples);
      selectionCriteria.push(`canonical_only: ${canonical.length}`);

      return {
        examples: canonical.map(correctionToFewShot),
        totalAvailable: canonical.length,
        selectionCriteria,
      };
    }

    // Strategy 1: Get canonical examples (highest priority)
    const canonical = await getCanonicalExamples(workflowType, Math.min(2, maxExamples));
    for (const c of canonical) {
      if (selectedExamples.length < maxExamples && !usedIds.has(c.id)) {
        selectedExamples.push(correctionToFewShot(c));
        usedIds.add(c.id);
      }
    }
    if (canonical.length > 0) {
      selectionCriteria.push(`canonical: ${canonical.length}`);
    }

    // Strategy 2: Get confusion pair examples
    if (includeConfusionPairs && selectedExamples.length < maxExamples) {
      const confusionPairs = getConfusionPairs(workflowType);
      const confusionExamples = await getConfusionPairExamples(
        workflowType,
        confusionPairs,
        maxExamples - selectedExamples.length
      );

      for (const c of confusionExamples) {
        if (selectedExamples.length < maxExamples && !usedIds.has(c.id)) {
          selectedExamples.push(correctionToFewShot(c));
          usedIds.add(c.id);
        }
      }
      if (confusionExamples.length > 0) {
        selectionCriteria.push(`confusion_pairs: ${confusionExamples.length}`);
      }
    }

    // Strategy 3: Get high-confidence mistakes
    if (selectedExamples.length < maxExamples) {
      const highConfMistakes = await getHighConfidenceMistakes(
        workflowType,
        minConfidenceForMistake,
        maxExamples - selectedExamples.length,
        Array.from(usedIds)
      );

      for (const c of highConfMistakes) {
        if (selectedExamples.length < maxExamples && !usedIds.has(c.id)) {
          selectedExamples.push(correctionToFewShot(c));
          usedIds.add(c.id);
        }
      }
      if (highConfMistakes.length > 0) {
        selectionCriteria.push(`high_confidence_mistakes: ${highConfMistakes.length}`);
      }
    }

    // Strategy 4: Fill with recent corrections
    if (selectedExamples.length < maxExamples) {
      const recent = await getRecentCorrections(
        workflowType,
        RECENT_DAYS_THRESHOLD,
        maxExamples - selectedExamples.length,
        Array.from(usedIds)
      );

      for (const c of recent) {
        if (selectedExamples.length < maxExamples && !usedIds.has(c.id)) {
          selectedExamples.push(correctionToFewShot(c));
          usedIds.add(c.id);
        }
      }
      if (recent.length > 0) {
        selectionCriteria.push(`recent: ${recent.length}`);
      }
    }

    // Get total available count
    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM qa_correction_examples WHERE workflow_type = $1`,
      [workflowType]
    );
    const totalAvailable = parseInt(totalResult.rows[0]?.count || '0', 10);

    const duration = Date.now() - startTime;

    if (selectedExamples.length === 0) {
      log.warn('FewShotService', {
        action: 'getRelevantExamples_empty',
        workflowType,
        totalAvailable,
        selectionCriteria,
        queryParams: {
          maxExamples,
          includeConfusionPairs,
          canonicalOnly,
          minConfidenceForMistake,
        },
        duration,
      });
    } else {
      log.debug('FewShotService', {
        action: 'getRelevantExamples',
        workflowType,
        selected: selectedExamples.length,
        totalAvailable,
        selectionCriteria,
        duration,
      });
    }

    return {
      examples: selectedExamples,
      totalAvailable,
      selectionCriteria,
    };
  } catch (error) {
    log.error('FewShotService', {
      action: 'getRelevantExamples',
      workflowType,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return empty result on error - don't fail VLM categorization
    return {
      examples: [],
      totalAvailable: 0,
      selectionCriteria: ['error: query_failed'],
    };
  }
}

// ============================================================================
// HELPER QUERIES
// ============================================================================

/**
 * Get canonical (curated) examples
 */
async function getCanonicalExamples(
  workflowType: WorkflowType,
  limit: number
): Promise<CorrectionRecord[]> {
  const result = await db.query<CorrectionRecordRow>(
    `SELECT * FROM qa_correction_examples
     WHERE workflow_type = $1
       AND is_canonical = true
     ORDER BY reviewed_count DESC, created_at DESC
     LIMIT $2`,
    [workflowType, limit]
  );

  return result.rows.map(rowToCorrectionRecord);
}

/**
 * Get examples for confusion pairs
 */
async function getConfusionPairExamples(
  workflowType: WorkflowType,
  confusionPairs: Array<[number, number]>,
  limit: number
): Promise<CorrectionRecord[]> {
  if (confusionPairs.length === 0) {
    return [];
  }

  // Build WHERE clause for confusion pairs
  const pairConditions = confusionPairs
    .map(
      ([_a, _b], i) =>
        `((vlm_predicted_step = $${i * 2 + 2} AND correct_step = $${i * 2 + 3}) OR ` +
        `(vlm_predicted_step = $${i * 2 + 3} AND correct_step = $${i * 2 + 2}))`
    )
    .join(' OR ');

  const params: (string | number)[] = [workflowType];
  for (const [a, b] of confusionPairs) {
    params.push(a, b);
  }
  params.push(limit);

  const result = await db.query<CorrectionRecordRow>(
    `SELECT * FROM qa_correction_examples
     WHERE workflow_type = $1
       AND (${pairConditions})
     ORDER BY is_canonical DESC, reviewed_count DESC, vlm_confidence DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(rowToCorrectionRecord);
}

/**
 * Get high-confidence mistakes (VLM was confident but wrong)
 */
async function getHighConfidenceMistakes(
  workflowType: WorkflowType,
  minConfidence: number,
  limit: number,
  excludeIds: string[]
): Promise<CorrectionRecord[]> {
  let query = `
    SELECT * FROM qa_correction_examples
    WHERE workflow_type = $1
      AND vlm_confidence >= $2
      AND vlm_predicted_step != correct_step
  `;
  const params: (string | number)[] = [workflowType, minConfidence];

  if (excludeIds.length > 0) {
    query += ` AND id NOT IN (${excludeIds.map((_, i) => `$${i + 3}`).join(', ')})`;
    params.push(...excludeIds);
  }

  query += ` ORDER BY vlm_confidence DESC, reviewed_count DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query<CorrectionRecordRow>(query, params);

  return result.rows.map(rowToCorrectionRecord);
}

/**
 * Get recent corrections
 */
async function getRecentCorrections(
  workflowType: WorkflowType,
  daysThreshold: number,
  limit: number,
  excludeIds: string[]
): Promise<CorrectionRecord[]> {
  let query = `
    SELECT * FROM qa_correction_examples
    WHERE workflow_type = $1
      AND created_at > NOW() - INTERVAL '${daysThreshold} days'
  `;
  const params: (string | number)[] = [workflowType];

  if (excludeIds.length > 0) {
    query += ` AND id NOT IN (${excludeIds.map((_, i) => `$${i + 2}`).join(', ')})`;
    params.push(...excludeIds);
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query<CorrectionRecordRow>(query, params);

  return result.rows.map(rowToCorrectionRecord);
}

// ============================================================================
// PROMPT BUILDING HELPER
// ============================================================================

/**
 * Build few-shot examples section for VLM prompt
 *
 * @param examples - Selected few-shot examples
 * @returns Formatted string for prompt injection
 */
export function buildFewShotPromptSection(examples: FewShotExample[]): string {
  if (examples.length === 0) {
    return '';
  }

  let section = `\n\nLEARNING FROM PAST CORRECTIONS:\n`;
  section += `The following examples show common mistakes to avoid:\n\n`;

  examples.forEach((ex, i) => {
    section += `Correction ${i + 1}:\n`;
    section += `- Photo showed: "${ex.photoDescription}"\n`;
    section += `- WRONG classification: Step ${ex.wrongStep} (${ex.wrongCategory})\n`;
    section += `- CORRECT classification: Step ${ex.correctStep} (${ex.correctCategory})\n`;
    section += `- Why: ${ex.correctionReason}\n\n`;
  });

  return section;
}

/**
 * Quick check if any corrections exist for a workflow
 * Use before calling getRelevantExamples to avoid unnecessary queries
 */
export async function hasCorrections(workflowType: WorkflowType): Promise<boolean> {
  try {
    const result = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM qa_correction_examples WHERE workflow_type = $1) as exists`,
      [workflowType]
    );

    return result.rows[0]?.exists || false;
  } catch (error) {
    log.warn('FewShotService', {
      action: 'hasCorrections',
      workflowType,
      error: error instanceof Error ? error.message : String(error),
    });

    return false;
  }
}
