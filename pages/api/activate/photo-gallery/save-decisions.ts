/**
 * API Route: POST /api/activate/photo-gallery/save-decisions
 *
 * Persists gallery good/bad decisions into the VLM learning pipeline:
 *   - vlm_corrections           → text few-shot for categorizationVlmService
 *   - vlm_visual_photo_examples → visual few-shot for stepQualityValidationService
 *
 * Good photos: is_canonical=true, priority=95, corrected_value=step_N
 * Bad photos:  is_canonical=false, priority=10, corrected_value='reject', error_pattern='poor_quality_example'
 *
 * Auth: requires `manager` role or higher — these rows change how every future
 * installation photo is evaluated by the VLM, so curation is privileged.
 *
 * Dedup: a photo_url already curated for activate/photo_categorization is a
 * silent no-op. vlm_corrections has no unique index, so we guard with a SELECT;
 * vlm_visual_photo_examples dedups via ON CONFLICT (photo_url).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { STEP_LABELS } from '@/modules/activate/components/photo-gallery/types';

/** Upper bound on decisions per request — one gallery step loads <= 60 photos. */
const MAX_DECISIONS = 200;

interface DecisionInput {
  drNumber: string;
  filename: string;
  url: string;
  stepNumber: number;
  decision: 'good' | 'bad';
  confidence: number;
}

interface SaveResult {
  saved: number;
  skipped: number;
  good: number;
  bad: number;
}

/**
 * Gallery photo URLs are minted server-side by the gallery API as
 * `/api/activate/photo/<dr>/<filename>`. Only that shape is accepted: the URL
 * is stored and later fetched server-side by the QA pipeline, so an arbitrary
 * or absolute URL would be an SSRF vector.
 */
function isAllowedPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('/api/activate/photo/');
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const decisions = req.body?.decisions as DecisionInput[] | undefined;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return apiResponse.badRequest(res, 'decisions must be a non-empty array');
  }
  if (decisions.length > MAX_DECISIONS) {
    return apiResponse.badRequest(res, `decisions cannot exceed ${MAX_DECISIONS} per request`);
  }

  const result: SaveResult = { saved: 0, skipped: 0, good: 0, bad: 0 };

  for (const d of decisions) {
    if (!d.drNumber || !d.filename || !d.url || !d.stepNumber || !d.decision) continue;
    if (d.stepNumber < 1 || d.stepNumber > 12) continue;
    if (d.decision !== 'good' && d.decision !== 'bad') continue;
    // confidence lands in NUMERIC(4,3); reject out-of-range so a bad value can't
    // throw mid-loop after the first INSERT and leave a split write.
    if (typeof d.confidence !== 'number' || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1) continue;
    if (!isAllowedPhotoUrl(d.url)) {
      log.warn('[SaveDecisions] Rejected non-allowlisted photo url', { url: d.url }, 'PhotoGallery');
      continue;
    }

    const isGood = d.decision === 'good';
    // Never trust a client-supplied label — derive the step name server-side so
    // it cannot be used to smuggle adversarial text into the VLM prompt.
    const stepName = STEP_LABELS[d.stepNumber] ?? `Step ${d.stepNumber}`;

    try {
      // Duplicate guard (no unique index on vlm_corrections → guard by SELECT).
      const existing = await pool.query(
        `SELECT id FROM vlm_corrections
          WHERE photo_url = $1
            AND module = 'activate'
            AND analysis_type = 'photo_categorization'
          LIMIT 1`,
        [d.url],
      );
      if ((existing.rowCount ?? 0) > 0) {
        result.skipped++;
        continue;
      }

      // Text few-shot pipeline. `source_id` is UUID-typed and there is no
      // gallery source row, so it stays NULL; the gallery origin is recorded in
      // `source_table` + `context_json`.
      await pool.query(
        `INSERT INTO vlm_corrections (
          module, analysis_type, source_table, photo_url,
          vlm_extracted_value, corrected_value, error_pattern, correction_notes,
          context_json, is_canonical, priority
        ) VALUES (
          'activate', 'photo_categorization', 'gallery', $1,
          $2, $3, $4, $5,
          $6::jsonb, $7, $8
        )`,
        [
          d.url,
          `step_${d.stepNumber}`,
          isGood ? `step_${d.stepNumber}` : 'reject',
          isGood ? null : 'poor_quality_example',
          isGood
            ? `Gallery: confirmed good example — step ${d.stepNumber} (${stepName})`
            : `Gallery: bad/reject example — step ${d.stepNumber} (${stepName})`,
          JSON.stringify({ drNumber: d.drNumber, filename: d.filename, stepNumber: d.stepNumber, stepName }),
          isGood, // is_canonical
          isGood ? 95 : 10, // priority
        ],
      );

      // Visual few-shot pipeline.
      await pool.query(
        `INSERT INTO vlm_visual_photo_examples
           (step_number, photo_url, label, dr_number, filename, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (photo_url) DO NOTHING`,
        [d.stepNumber, d.url, isGood ? 'positive' : 'negative', d.drNumber, d.filename, d.confidence],
      );

      result.saved++;
      if (isGood) result.good++;
      else result.bad++;
    } catch (err) {
      log.error(
        '[SaveDecisions] Error saving decision',
        { url: d.url, error: err instanceof Error ? err.message : String(err) },
        'PhotoGallery',
      );
      // Continue — partial success is acceptable; the response reports counts.
    }
  }

  log.info(`[SaveDecisions] Saved ${result.saved}, skipped ${result.skipped}`, undefined, 'PhotoGallery');
  return apiResponse.success(res, result);
}

export default withAuth(withRole('manager')(handler));
