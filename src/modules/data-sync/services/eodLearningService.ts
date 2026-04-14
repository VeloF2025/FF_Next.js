/**
 * EOD VLM Learning Service
 * Records corrections when users edit extracted data before saving.
 * Feeds back into few-shot examples for future extractions.
 */

import { recordVlmCorrection } from '@/services/vlmLearningService';
import { log } from '@/lib/logger';
import type { EodVlmEntry } from '../types';

/**
 * Compare VLM extraction with user-corrected values and record differences.
 * Called when the user saves a sheet (POST /api/eod/sheets).
 * Fire-and-forget — does not block the save.
 */
export async function recordEodCorrections(
  vlmEntries: EodVlmEntry[],
  correctedEntries: {
    row_number: number;
    dr_number: string | null;
    ont_serial: string | null;
    gizzu_serial: string | null;
    pon_number: string | null;
    address: string | null;
  }[],
  sheetId: string,
  photoUrl?: string | null
): Promise<{ recorded: number; skipped: number }> {
  let recorded = 0;
  let skipped = 0;

  for (const corrected of correctedEntries) {
    const vlm = vlmEntries.find((e) => e.row_number === corrected.row_number);
    if (!vlm) continue;

    const pairs: Array<{
      field: string;
      analysisType: 'eod_sheet_dr' | 'eod_sheet_address' | 'eod_sheet_gizzu' | 'eod_sheet_pon';
      vlmValue: string | null;
      correctedValue: string | null;
    }> = [
      { field: 'dr_number', analysisType: 'eod_sheet_dr', vlmValue: vlm.dr_number, correctedValue: corrected.dr_number },
      { field: 'address', analysisType: 'eod_sheet_address', vlmValue: vlm.address, correctedValue: corrected.address },
      { field: 'gizzu_serial', analysisType: 'eod_sheet_gizzu', vlmValue: vlm.gizzu_serial, correctedValue: corrected.gizzu_serial },
      { field: 'pon_number', analysisType: 'eod_sheet_pon', vlmValue: vlm.pon_number, correctedValue: corrected.pon_number },
    ];

    for (const pair of pairs) {
      // Skip if both null or values match
      if (!pair.correctedValue) { skipped++; continue; }
      const vlmNorm = (pair.vlmValue || '').trim().toUpperCase();
      const corrNorm = pair.correctedValue.trim().toUpperCase();
      if (vlmNorm === corrNorm) { skipped++; continue; }

      try {
        await recordVlmCorrection({
          module: 'data-sync',
          analysisType: pair.analysisType,
          sourceId: sheetId,
          sourceTable: 'eod_install_sheets',
          photoUrl: photoUrl || undefined,
          vlmExtractedValue: pair.vlmValue,
          vlmConfidence: vlm.confidence,
          correctedValue: pair.correctedValue,
          correctionReason: classifyError(pair.vlmValue, pair.correctedValue),
          correctionNotes: `Row ${corrected.row_number} ${pair.field}`,
          context: {
            row_number: corrected.row_number,
            field: pair.field,
            sheet_id: sheetId,
          },
        });
        recorded++;
      } catch (err) {
        log.warn('[EOD-Learning] Failed to record correction', {
          field: pair.field,
          row: corrected.row_number,
          error: err,
        });
      }
    }
  }

  if (recorded > 0) {
    log.info('[EOD-Learning] Corrections recorded', { recorded, skipped, sheetId });
  }

  return { recorded, skipped };
}

function classifyError(vlm: string | null, correct: string): 'digit_confusion' | 'wrong_field' | 'partial_extraction' | 'hallucination' | 'other' {
  if (!vlm) return 'hallucination';

  const v = vlm.toUpperCase();
  const c = correct.toUpperCase();

  // Count differing characters
  let diffs = 0;
  const maxLen = Math.max(v.length, c.length);
  for (let i = 0; i < maxLen; i++) {
    if (v[i] !== c[i]) diffs++;
  }

  if (diffs <= 2) return 'digit_confusion';
  if (v.length !== c.length) return 'partial_extraction';
  if (diffs > maxLen * 0.5) return 'hallucination';
  return 'other';
}
