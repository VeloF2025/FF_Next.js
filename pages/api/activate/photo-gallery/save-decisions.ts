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
 * Re-curation: a photo_url already curated is UPDATED, not skipped — a manual
 * gallery decision wins over a prior (often auto-categorization) row, and the
 * good/bad label can be changed. vlm_corrections has no unique index, so we
 * SELECT then INSERT-or-UPDATE; vlm_visual_photo_examples upserts via
 * ON CONFLICT (photo_url) DO UPDATE so a flipped label/confidence persists.
 * (A prior DO NOTHING / skip-on-exist is why dome-joint examples — which almost
 * always already have a categorization row — appeared not to save.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import { computeDHash } from '@/lib/imageHash';
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

    // Value fields shared by the INSERT and UPDATE paths below.
    const extractedValue = `step_${d.stepNumber}`;
    const correctedValue = isGood ? `step_${d.stepNumber}` : 'reject';
    const errorPattern = isGood ? null : 'poor_quality_example';
    const notes = isGood
      ? `Gallery: confirmed good example — step ${d.stepNumber} (${stepName})`
      : `Gallery: bad/reject example — step ${d.stepNumber} (${stepName})`;
    const contextJson = JSON.stringify({ drNumber: d.drNumber, filename: d.filename, stepNumber: d.stepNumber, stepName });
    const priority = isGood ? 95 : 10;

    try {
      // A photo may already carry a correction row — auto-categorization writes
      // one for many photos, and dome-joint (step 11/12) photos almost always
      // have one. Manual gallery curation MUST win, so UPDATE the existing row
      // rather than skip it; otherwise those photos could never be saved as
      // good/bad examples. (No unique index on vlm_corrections → guard by
      // SELECT, then INSERT or UPDATE.)
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM vlm_corrections
          WHERE photo_url = $1 AND module = 'activate' AND analysis_type = 'photo_categorization'
          LIMIT 1`,
        [d.url],
      );

      if ((existing.rowCount ?? 0) > 0) {
        await pool.query(
          `UPDATE vlm_corrections SET
             source_table = 'gallery',
             vlm_extracted_value = $1, corrected_value = $2, error_pattern = $3,
             correction_notes = $4, context_json = $5::jsonb,
             is_canonical = $6, priority = $7
           WHERE id = $8`,
          [extractedValue, correctedValue, errorPattern, notes, contextJson, isGood, priority, existing.rows[0].id],
        );
      } else {
        // `source_id` is UUID-typed and there is no gallery source row, so it
        // stays NULL; the gallery origin is recorded in source_table + context.
        await pool.query(
          `INSERT INTO vlm_corrections (
            module, analysis_type, source_table, photo_url,
            vlm_extracted_value, corrected_value, error_pattern, correction_notes,
            context_json, is_canonical, priority
          ) VALUES (
            'activate', 'photo_categorization', 'gallery', $1,
            $2, $3, $4, $5, $6::jsonb, $7, $8
          )`,
          [d.url, extractedValue, correctedValue, errorPattern, notes, contextJson, isGood, priority],
        );
      }

      // Perceptual hash for relevance-based few-shot selection (best-effort:
      // a fetch/decode failure must not block curation — the backfill script
      // and recency fallback cover a NULL phash). See src/lib/vlmGallery.ts.
      let phash: string | null = null;
      try {
        const b64 = await fetchPhotoAsBase64(resolveInternalPhotoUrl(d.url));
        phash = await computeDHash(b64);
      } catch (err) {
        log.warn('[SaveDecisions] Could not compute phash (will backfill later)', { url: d.url, error: String(err) }, 'PhotoGallery');
      }

      // Visual few-shot pipeline. DO UPDATE (not DO NOTHING) so re-curating a
      // photo flips its label (good<->bad) and refreshes confidence/phash — a
      // stale DO NOTHING is why a changed/dome-joint decision appeared not to save.
      await pool.query(
        `INSERT INTO vlm_visual_photo_examples
           (step_number, photo_url, label, dr_number, filename, confidence, phash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (photo_url) DO UPDATE SET
           step_number = EXCLUDED.step_number,
           label = EXCLUDED.label,
           dr_number = EXCLUDED.dr_number,
           filename = EXCLUDED.filename,
           confidence = EXCLUDED.confidence,
           phash = COALESCE(EXCLUDED.phash, vlm_visual_photo_examples.phash)`,
        [d.stepNumber, d.url, isGood ? 'positive' : 'negative', d.drNumber, d.filename, d.confidence, phash],
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
