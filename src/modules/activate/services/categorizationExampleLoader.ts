/**
 * HITL example loaders for the photo categorization pipeline.
 *
 * Extracted from categorizationVlmService.ts to keep that file under the
 * 300-line CLAUDE.md limit. Each loader fails open (returns []) and logs a
 * structured warning so categorization itself never bombs because we couldn't
 * source corrections.
 */

import { log } from '@/lib/logger';
import {
  FewShotExample,
  getRelevantExamples,
  hasCorrections,
  PositiveExample,
  getPositiveExamples,
  hasConfirmedCorrect,
} from '@/modules/qa-learning';

export async function loadFewShotExamples(drNumber: string): Promise<FewShotExample[]> {
  try {
    const hasCorrectionData = await hasCorrections('dr_photo');
    if (!hasCorrectionData) {
      log.warn(
        'Few-shot learning inactive: no corrections available',
        {
          action: 'fewShotSkipped',
          reason: 'no_corrections_available',
          workflowType: 'dr_photo',
          drNumber,
        },
        'CategorizationVlm',
      );
      return [];
    }

    const selectionResult = await getRelevantExamples({
      workflowType: 'dr_photo',
      maxExamples: 5,
      includeConfusionPairs: true,
    });

    if (selectionResult.examples.length === 0) {
      log.warn(
        'Few-shot learning inactive: getRelevantExamples returned empty',
        {
          action: 'fewShotEmpty',
          workflowType: 'dr_photo',
          drNumber,
          selectionCriteria: selectionResult.selectionCriteria,
        },
        'CategorizationVlm',
      );
    } else {
      log.info(
        'Few-shot examples loaded for categorization',
        {
          action: 'fewShotLoaded',
          drNumber,
          exampleCount: selectionResult.examples.length,
          criteria: selectionResult.selectionCriteria,
        },
        'CategorizationVlm',
      );
    }
    return selectionResult.examples;
  } catch (error) {
    log.warn(
      'Few-shot example loading failed',
      {
        action: 'fewShotLoadFailed',
        drNumber,
        error: error instanceof Error ? error.message : String(error),
      },
      'CategorizationVlm',
    );
    return [];
  }
}

export async function loadPositiveExamples(drNumber: string): Promise<PositiveExample[]> {
  try {
    const hasPositiveData = await hasConfirmedCorrect('dr_photo');
    if (!hasPositiveData) {
      log.warn(
        'Positive examples inactive: no confirmed-correct data available',
        {
          action: 'positiveExamplesSkipped',
          reason: 'no_confirmed_correct_available',
          workflowType: 'dr_photo',
          drNumber,
        },
        'CategorizationVlm',
      );
      return [];
    }

    const positiveResult = await getPositiveExamples({
      workflowType: 'dr_photo',
      maxExamples: 3,
      minConfidence: 0.9,
    });

    if (positiveResult.examples.length === 0) {
      log.warn(
        'Positive examples inactive: getPositiveExamples returned empty',
        {
          action: 'positiveExamplesEmpty',
          workflowType: 'dr_photo',
          drNumber,
        },
        'CategorizationVlm',
      );
    } else {
      log.info(
        'Positive examples loaded for categorization',
        {
          action: 'positiveExamplesLoaded',
          drNumber,
          exampleCount: positiveResult.examples.length,
        },
        'CategorizationVlm',
      );
    }
    return positiveResult.examples;
  } catch (error) {
    log.warn(
      'Positive example loading failed',
      {
        action: 'positiveExamplesLoadFailed',
        drNumber,
        error: error instanceof Error ? error.message : String(error),
      },
      'CategorizationVlm',
    );
    return [];
  }
}
