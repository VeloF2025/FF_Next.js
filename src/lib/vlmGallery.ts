// src/lib/vlmGallery.ts
// Shared utility: load gallery examples from vlm_visual_photo_examples.
// Used by stepQualityValidationService (activation auto-QA) and
// the sitecam validate endpoint (both activation + civils).

import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import type { GalleryExamples } from '@/modules/activate/services/stepQualityCriteria';

const MODULE = 'vlmGallery';

export async function loadGalleryExamples(
  step: number,
  jobType: 'activation' | 'civils'
): Promise<GalleryExamples | undefined> {
  try {
    // Fetch up to 6 of EACH label independently — a single combined LIMIT
    // would let positives starve negatives (or vice-versa) for a step.
    const fetchByLabel = (label: 'positive' | 'negative') =>
      pool.query<{ photo_url: string }>(
        `SELECT photo_url
         FROM vlm_visual_photo_examples
         WHERE step_number = $1
           AND job_type = $2
           AND label = $3
         ORDER BY saved_at DESC
         LIMIT 6`,
        [step, jobType, label]
      );

    const [positiveQuery, negativeQuery] = await Promise.all([
      fetchByLabel('positive'),
      fetchByLabel('negative'),
    ]);
    const positiveRows = positiveQuery.rows;
    const negativeRows = negativeQuery.rows;
    if (positiveRows.length === 0 && negativeRows.length === 0) return undefined;

    const toBase64 = async (url: string): Promise<string | null> => {
      try {
        // Gallery rows store the auth-protected proxy path; server-side we have
        // no session cookie, so resolve to the backend source URL first —
        // otherwise every example 401s and is silently dropped (found 2026-06-11:
        // the VLM was receiving ZERO gallery examples).
        return await fetchPhotoAsBase64(resolveInternalPhotoUrl(url));
      } catch (err) {
        log.warn('Failed to fetch gallery example as base64', { url, err: String(err) }, MODULE);
        return null;
      }
    };

    const [positiveResults, negativeResults] = await Promise.all([
      Promise.all(positiveRows.map((r) => toBase64(r.photo_url))),
      Promise.all(negativeRows.map((r) => toBase64(r.photo_url))),
    ]);

    return {
      positiveBase64: positiveResults.filter((b): b is string => b !== null),
      negativeBase64: negativeResults.filter((b): b is string => b !== null),
    };
  } catch (err) {
    log.warn('Failed to load gallery visual examples', { err }, MODULE);
    return undefined;
  }
}
