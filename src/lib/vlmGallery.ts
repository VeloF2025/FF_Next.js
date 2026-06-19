// src/lib/vlmGallery.ts
// Shared utility: load gallery examples from vlm_visual_photo_examples.
// Used by stepQualityValidationService (activation auto-QA) and
// the sitecam validate endpoint (both activation + civils).

import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import { computeDHash, hammingDistance } from '@/lib/imageHash';
import type { GalleryExamples } from '@/modules/activate/services/stepQualityCriteria';

const MODULE = 'vlmGallery';

/** Max gallery examples injected per label (positive/negative) per step. */
export const GALLERY_EXAMPLES_PER_LABEL = 6;

/**
 * When ranking by relevance, consider this many newest candidates per label
 * before picking the closest GALLERY_EXAMPLES_PER_LABEL. Bounds the SELECT and
 * the dHash comparison cost while still giving similarity a real pool to choose
 * from.
 */
const RELEVANCE_CANDIDATE_POOL = 60;

interface ExampleRow {
  photo_url: string;
  phash: string | null;
}

/**
 * Load curated few-shot examples for a step.
 *
 * @param queryPhotoBase64 - The photo being judged. When provided, examples are
 *   ranked by perceptual similarity (dHash Hamming distance) to this photo so
 *   the VLM sees the MOST RELEVANT approved examples, not just the newest. Rows
 *   without a stored phash (not yet backfilled) fall back to recency order, so
 *   omitting this — or running before the phash backfill — behaves exactly like
 *   the previous newest-first selection. Auto-QA omits it; SiteCam passes it.
 */
export async function loadGalleryExamples(
  step: number,
  jobType: 'activation' | 'civils',
  queryPhotoBase64?: string
): Promise<GalleryExamples | undefined> {
  try {
    const queryHash = queryPhotoBase64 ? await computeDHash(queryPhotoBase64) : null;
    // Narrow to a non-null const so the closure in pickRows avoids the `!` assertion.
    const resolvedQueryHash: string | null = queryHash;
    const useRelevance = resolvedQueryHash !== null;

    // With relevance we pull a larger candidate pool and rank in JS; without it
    // the DB LIMIT already gives the newest N.
    const perLabelLimit = useRelevance ? RELEVANCE_CANDIDATE_POOL : GALLERY_EXAMPLES_PER_LABEL;

    const fetchByLabel = (label: 'positive' | 'negative') =>
      pool.query<ExampleRow>(
        `SELECT photo_url, phash
         FROM vlm_visual_photo_examples
         WHERE step_number = $1
           AND job_type = $2
           AND label = $3
         ORDER BY saved_at DESC
         LIMIT ${perLabelLimit}`,
        [step, jobType, label]
      );

    const [positiveQuery, negativeQuery] = await Promise.all([
      fetchByLabel('positive'),
      fetchByLabel('negative'),
    ]);

    // Rank by similarity (closest first); rows without a phash keep recency
    // order and sort after the hashed ones, then trim to the injected count.
    const pickRows = (rows: ExampleRow[]): ExampleRow[] => {
      if (!resolvedQueryHash) return rows.slice(0, GALLERY_EXAMPLES_PER_LABEL);
      return rows
        .map((r, i) => ({
          r,
          i,
          d: r.phash ? hammingDistance(resolvedQueryHash, r.phash) : Infinity,
        }))
        .sort((a, b) => a.d - b.d || a.i - b.i)
        .slice(0, GALLERY_EXAMPLES_PER_LABEL)
        .map((x) => x.r);
    };

    const positiveRows = pickRows(positiveQuery.rows);
    const negativeRows = pickRows(negativeQuery.rows);
    if (positiveRows.length === 0 && negativeRows.length === 0) return undefined;

    const toBase64 = async (url: string): Promise<string | null> => {
      try {
        // Gallery rows store the auth-protected proxy path; server-side we have
        // no session cookie, so resolve to the backend source URL first —
        // otherwise every example 401s and is silently dropped (found 2026-06-11:
        // the VLM was receiving ZERO gallery examples).
        const raw = await fetchPhotoAsBase64(resolveInternalPhotoUrl(url));
        // Full-resolution gallery photos blow the VLM's 32k context once ~12
        // examples are attached (found 2026-06-12: every validate request got
        // HTTP 400 and failed open). Resize to the VLM working size first.
        return await optimizeForVlm(raw, { maxWidth: 1024, maxHeight: 768 });
      } catch (err) {
        log.warn('Failed to fetch gallery example as base64', { url, err: String(err) }, MODULE);
        return null;
      }
    };

    const [positiveResults, negativeResults] = await Promise.all([
      Promise.all(positiveRows.map((r) => toBase64(r.photo_url))),
      Promise.all(negativeRows.map((r) => toBase64(r.photo_url))),
    ]);

    const positiveBase64 = positiveResults.filter((b): b is string => b !== null);
    const negativeBase64 = negativeResults.filter((b): b is string => b !== null);

    // Observability: how many examples actually reached the prompt and how they
    // were chosen. A rejection with positives:0 here means the gallery is not
    // reaching the VLM (the silent failure we have hit before).
    const hashedCandidates =
      positiveQuery.rows.filter((r) => r.phash).length +
      negativeQuery.rows.filter((r) => r.phash).length;
    log.info(
      'Loaded gallery examples',
      {
        step,
        jobType,
        mode: useRelevance ? 'relevance' : 'recency',
        positives: positiveBase64.length,
        negatives: negativeBase64.length,
        hashedCandidates,
      },
      MODULE
    );

    return { positiveBase64, negativeBase64 };
  } catch (err) {
    log.warn('Failed to load gallery visual examples', { err }, MODULE);
    return undefined;
  }
}
