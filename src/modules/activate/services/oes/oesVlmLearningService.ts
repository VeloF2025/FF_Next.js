/**
 * OES VLM Learning Service
 *
 * Compares VLM-extracted serials against OES ground truth and records
 * corrections into vlm_corrections / vlm_metrics for model improvement.
 * Runs fire-and-forget after OES import.
 */

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { recordVlmCorrection } from '@/services/vlmLearningService';

const logger = createLogger('oes/oesVlmLearningService');

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Classify serial OCR error pattern by comparing VLM output to OES truth.
 * Returns an error pattern string for the vlm_corrections table.
 */
export function classifySerialError(vlm: string, oes: string): string {
  if (vlm.length !== oes.length) return 'length_mismatch';

  let diffCount = 0;
  const diffs: string[] = [];
  for (let i = 0; i < vlm.length; i++) {
    if (vlm[i] !== oes[i]) {
      diffCount++;
      diffs.push(`${vlm[i]}->${oes[i]}`);
    }
  }

  if (diffCount === 1) {
    const pair = diffs[0];
    if (pair === '1->7' || pair === '7->1') return 'digit_1_7';
    if (pair === '1->6' || pair === '6->1') return 'digit_1_6';
    if (pair === '6->8' || pair === '8->6') return 'digit_6_8';
    if (pair === '8->0' || pair === '0->8') return 'digit_8_0';
    if (pair === '9->4' || pair === '4->9') return 'digit_9_4';
    if (pair === '2->3' || pair === '3->2') return 'digit_2_3';
    return `single_char_${diffCount}`;
  }

  if (diffCount <= 3) return `multi_char_${diffCount}`;
  return 'totally_wrong';
}

/**
 * Determine correction reason from error pattern.
 */
export function errorPatternToReason(pattern: string): 'digit_confusion' | 'partial_extraction' | 'other' {
  if (pattern.startsWith('digit_')) return 'digit_confusion';
  if (pattern === 'length_mismatch') return 'partial_extraction';
  return 'other';
}

// ============================================================================
// CORRECTIONS BATCH
// ============================================================================

interface ReviewRow {
  id: string;
  drop_number: string;
  oes_serial: string;
  vlm_ont_serial_step6: string | null;
  vlm_ont_serial_step9: string | null;
  serial_extraction_method_step6: string | null;
  serial_extraction_method_step9: string | null;
}

interface ExistingCorrectionRow {
  source_id: string;
  analysis_type: string;
}

/**
 * Compare VLM-extracted serials against OES ground truth and record
 * corrections + metrics into vlm_corrections / vlm_metrics.
 *
 * Runs fire-and-forget after OES import.
 */
export async function recordVlmCorrectionsFromOes(dropNumbers: string[]): Promise<void> {
  const BATCH_SIZE = 200;
  let totalCorrections = 0;
  let totalCorrect = 0;
  let totalSkipped = 0;

  for (let i = 0; i < dropNumbers.length; i += BATCH_SIZE) {
    const batch = dropNumbers.slice(i, i + BATCH_SIZE);

    const result = await pool.query(
      `SELECT id, drop_number, oes_serial,
              vlm_ont_serial_step6, vlm_ont_serial_step9,
              serial_extraction_method_step6, serial_extraction_method_step9
       FROM dr_photo_unified_reviews
       WHERE drop_number = ANY($1::text[])
         AND oes_serial IS NOT NULL AND oes_serial != ''`,
      [batch]
    );

    const reviewIds = result.rows.map((r: ReviewRow) => r.id);
    const existingResult = reviewIds.length > 0 ? await pool.query(
      `SELECT source_id, analysis_type FROM vlm_corrections
       WHERE module = 'activate'
         AND analysis_type IN ('ont_serial_back', 'ont_serial_front')
         AND source_id = ANY($1::uuid[])`,
      [reviewIds]
    ) : { rows: [] };

    const existingKeys = new Set(
      existingResult.rows.map((r: ExistingCorrectionRow) =>
        `${r.source_id}:${r.analysis_type}`)
    );

    for (const row of result.rows as ReviewRow[]) {
      const oesSerial = row.oes_serial.trim().toUpperCase();

      if (row.vlm_ont_serial_step6) {
        const vlmS6 = row.vlm_ont_serial_step6.trim().toUpperCase();

        if (vlmS6 === oesSerial) {
          totalCorrect++;
        } else if (!existingKeys.has(`${row.id}:ont_serial_back`)) {
          const errorPattern = classifySerialError(vlmS6, oesSerial);
          totalCorrections++;

          recordVlmCorrection({
            module: 'activate',
            analysisType: 'ont_serial_back',
            sourceId: row.id,
            sourceTable: 'dr_photo_unified_reviews',
            vlmExtractedValue: row.vlm_ont_serial_step6,
            correctedValue: row.oes_serial,
            correctionReason: errorPatternToReason(errorPattern),
            correctionNotes: `Auto-corrected from OES. Pattern: ${errorPattern}`,
            context: {
              drop_number: row.drop_number,
              error_pattern: errorPattern,
              extraction_method: row.serial_extraction_method_step6 ?? 'vlm',
              source: 'oes_import',
            },
            correctedByName: 'OES Import (automated)',
          }).catch(err => {
            logger.warn(`VLM correction failed for ${row.drop_number} step6`, {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        } else {
          totalSkipped++;
        }
      }

      if (row.vlm_ont_serial_step9) {
        const vlmS9 = row.vlm_ont_serial_step9.trim().toUpperCase();

        if (vlmS9 === oesSerial) {
          totalCorrect++;
        } else if (!existingKeys.has(`${row.id}:ont_serial_front`)) {
          const errorPattern = classifySerialError(vlmS9, oesSerial);
          totalCorrections++;

          recordVlmCorrection({
            module: 'activate',
            analysisType: 'ont_serial_front',
            sourceId: row.id,
            sourceTable: 'dr_photo_unified_reviews',
            vlmExtractedValue: row.vlm_ont_serial_step9,
            correctedValue: row.oes_serial,
            correctionReason: errorPatternToReason(errorPattern),
            correctionNotes: `Auto-corrected from OES. Pattern: ${errorPattern}`,
            context: {
              drop_number: row.drop_number,
              error_pattern: errorPattern,
              extraction_method: row.serial_extraction_method_step9 ?? 'vlm',
              source: 'oes_import',
            },
            correctedByName: 'OES Import (automated)',
          }).catch(err => {
            logger.warn(`VLM correction failed for ${row.drop_number} step9`, {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        } else {
          totalSkipped++;
        }
      }
    }
  }

  logger.info(`VLM learning: ${totalCorrections} corrections, ${totalCorrect} correct, ${totalSkipped} skipped`);
}
