/**
 * HITL example loaders for the photo categorization pipeline.
 *
 * Extracted from categorizationVlmService.ts to keep that file under the
 * 300-line CLAUDE.md limit. Each loader fails open (returns []) and logs a
 * structured warning so categorization itself never bombs because we couldn't
 * source corrections.
 */

import { log } from '@/lib/logger';
import { pool } from '@/lib/db';
import {
  FewShotExample,
  getRelevantExamples,
  hasCorrections,
  PositiveExample,
  getPositiveExamples,
  hasConfirmedCorrect,
} from '@/modules/qa-learning';

interface GalleryCorrectionRow {
  vlm_extracted_value: string;
  corrected_value: string;
  correction_notes: string | null;
  is_canonical: boolean;
}

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

/**
 * Load gallery-curated categorization corrections and render them as a prompt
 * section. These are good/bad examples a reviewer hand-picked in the VLM
 * Learning photo gallery (persisted to `vlm_corrections`). Gallery examples are
 * global (not DR-scoped) and capped so the prompt cannot grow unbounded.
 *
 * Returns '' when there are no examples or the query fails — categorization
 * must never break because gallery sourcing did.
 */
export async function loadGalleryExamples(): Promise<string> {
  try {
    const { rows } = await pool.query<GalleryCorrectionRow>(
      `SELECT vlm_extracted_value, corrected_value, correction_notes, is_canonical
         FROM vlm_corrections
        WHERE module = 'activate'
          AND analysis_type = 'photo_categorization'
        ORDER BY is_canonical DESC, priority DESC, created_at DESC
        LIMIT 8`,
    );

    if (rows.length === 0) return '';

    const goodRows = rows.filter((r: GalleryCorrectionRow) => r.corrected_value !== 'reject');
    const badRows = rows.filter((r: GalleryCorrectionRow) => r.corrected_value === 'reject');
    const lines: string[] = ['\n### GALLERY-CURATED EXAMPLES:'];

    if (goodRows.length > 0) {
      lines.push('\nConfirmed ACCEPTABLE photos (prioritise accepting these):');
      goodRows.slice(0, 4).forEach((r: GalleryCorrectionRow) => {
        lines.push(`✅ ACCEPT photos for ${r.vlm_extracted_value}`);
        if (r.correction_notes) lines.push(`   (${r.correction_notes})`);
      });
    }
    if (badRows.length > 0) {
      lines.push('\nConfirmed REJECT photos (do not accept photos like these):');
      badRows.slice(0, 4).forEach((r: GalleryCorrectionRow) => {
        lines.push(`❌ REJECT photos for ${r.vlm_extracted_value}`);
        if (r.correction_notes) lines.push(`   (${r.correction_notes})`);
      });
    }

    log.info(
      'Gallery-curated categorization examples loaded',
      { action: 'galleryExamplesLoaded', good: goodRows.length, bad: badRows.length },
      'CategorizationVlm',
    );
    return lines.join('\n');
  } catch (error) {
    log.warn(
      'Gallery example loading failed — continuing without it',
      {
        action: 'galleryExamplesLoadFailed',
        error: error instanceof Error ? error.message : String(error),
      },
      'CategorizationVlm',
    );
    return '';
  }
}
