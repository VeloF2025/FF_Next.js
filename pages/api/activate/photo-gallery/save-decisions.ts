/**
 * API Route: POST /api/activate/photo-gallery/save-decisions
 *
 * Persists gallery good/bad decisions into the VLM learning pipeline:
 *   - vlm_corrections       → text few-shot for categorizationVlmService
 *   - vlm_visual_photo_examples → visual few-shot for stepQualityValidationService
 *
 * Good photos: is_canonical=true, priority=95, corrected_value=step_N
 * Bad photos:  is_canonical=false, priority=10, corrected_value='reject', error_pattern='poor_quality_example'
 *
 * Duplicate guard: same source_id + module + analysis_type is a silent no-op.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';

interface DecisionInput {
  drNumber: string;
  filename: string;
  url: string;
  stepNumber: number;
  stepName: string;
  decision: 'good' | 'bad';
  confidence: number;
}

interface SaveResult {
  saved: number;
  skipped: number;
  good: number;
  bad: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const decisions = req.body?.decisions as DecisionInput[] | undefined;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return apiResponse.error(res, 'VALIDATION_ERROR' as never, 'decisions must be a non-empty array');
  }

  const result: SaveResult = { saved: 0, skipped: 0, good: 0, bad: 0 };

  for (const d of decisions) {
    if (!d.drNumber || !d.filename || !d.url || !d.stepNumber || !d.decision) continue;
    if (d.stepNumber < 1 || d.stepNumber > 12) continue;
    if (d.decision !== 'good' && d.decision !== 'bad') continue;

    const sourceId = `gallery/${d.drNumber}/${d.filename}`;
    const isGood = d.decision === 'good';

    try {
      // Duplicate guard
      const existing = await pool.query(
        `SELECT id FROM vlm_corrections
         WHERE source_id = $1
           AND module = 'activate'
           AND analysis_type = 'photo_categorization'
         LIMIT 1`,
        [sourceId]
      );
      if ((existing.rowCount ?? 0) > 0) {
        result.skipped++;
        continue;
      }

      // Write to vlm_corrections (text few-shot pipeline)
      await pool.query(
        `INSERT INTO vlm_corrections (
          module, analysis_type, source_id, photo_url,
          vlm_extracted_value, corrected_value, error_pattern, correction_notes,
          context_json, is_canonical, priority
        ) VALUES (
          'activate', 'photo_categorization', $1, $2,
          $3, $4, $5, $6,
          $7::jsonb, $8, $9
        )`,
        [
          sourceId,
          d.url,
          `step_${d.stepNumber}`,
          isGood ? `step_${d.stepNumber}` : 'reject',
          isGood ? null : 'poor_quality_example',
          isGood
            ? `Gallery: confirmed good example — step ${d.stepNumber} (${d.stepName})`
            : `Gallery: bad/reject example — step ${d.stepNumber} (${d.stepName})`,
          JSON.stringify({ stepNumber: d.stepNumber, stepName: d.stepName }),
          isGood,           // is_canonical
          isGood ? 95 : 10, // priority
        ]
      );

      // Write to vlm_visual_photo_examples (visual few-shot pipeline)
      await pool.query(
        `INSERT INTO vlm_visual_photo_examples
           (step_number, photo_url, label, dr_number, filename, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (photo_url) DO NOTHING`,
        [d.stepNumber, d.url, isGood ? 'positive' : 'negative', d.drNumber, d.filename, d.confidence]
      );

      result.saved++;
      if (isGood) result.good++;
      else result.bad++;
    } catch (err) {
      log.error('[SaveDecisions] Error saving decision', { sourceId, err }, 'PhotoGallery');
      // Continue processing remaining decisions — partial success is fine
    }
  }

  log.info(
    `[SaveDecisions] Saved ${result.saved}, skipped ${result.skipped}`,
    undefined,
    'PhotoGallery'
  );
  return apiResponse.success(res, result);
}

export default withAuth(handler);
