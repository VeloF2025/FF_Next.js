/**
 * Step Quality Validation Service
 *
 * Targeted VLM post-check that runs after photo categorization.
 * For each photo assigned to a step, validates that it meets the visual
 * quality criteria for that step using VISUAL FEW-SHOT prompting.
 *
 * Step 6 is excluded — handled by validateOntBackCables.
 * Criteria + prompt builder live in ./stepQualityCriteria.
 *
 * On any VLM/network error the original decision is preserved (checkFailed=true),
 * so transient failures never cause false discards.
 */

import { log } from '@/lib/logger';
import { pool } from '@/lib/db';
import { fetchPhotoAsBase64 } from './photoFetchService';
import {
  QUALITY_CHECK_STEPS,
  STEP_CRITERIA,
  buildMessageContent,
  type GalleryExamples,
  type QualityCheckStep,
} from './stepQualityCriteria';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'StepQualityValidator';

export { QUALITY_CHECK_STEPS };

export interface StepQualityCheckResult {
  filename: string;
  step: number;
  passes: boolean;
  failReason: string | null;
  checkFailed: boolean;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkOnePhoto(
  drNumber: string,
  photo: { filename: string; url: string; step: number }
): Promise<StepQualityCheckResult> {
  const step = photo.step as QualityCheckStep;
  const criteria = STEP_CRITERIA[step];

  if (!criteria) {
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: false };
  }

  let newPhotoBase64: string;
  try {
    newPhotoBase64 = await fetchPhotoAsBase64(photo.url);
  } catch (err) {
    log.warn(`Failed to fetch photo for quality check: ${photo.filename}`, {
      dropNumber: drNumber,
      error: errMessage(err),
    }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }

  // Load gallery-curated visual examples for this step
  let galleryExamples: GalleryExamples | undefined;
  try {
    const { rows } = await pool.query<{ photo_url: string; label: string }>(
      `SELECT photo_url, label
       FROM vlm_visual_photo_examples
       WHERE step_number = $1
       ORDER BY saved_at DESC
       LIMIT 6`,
      [step]
    );
    const positiveRows = rows.filter((r) => r.label === 'positive');
    const negativeRows = rows.filter((r) => r.label === 'negative');

    if (positiveRows.length > 0 || negativeRows.length > 0) {
      // Fetch all gallery URLs as base64 in parallel (non-fatal on individual failures)
      const toBase64 = async (url: string): Promise<string | null> => {
        try {
          return await fetchPhotoAsBase64(url);
        } catch (fetchErr) {
          log.warn('[StepQualityValidation] Failed to fetch gallery example as base64', {
            url,
            err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          }, MODULE);
          return null;
        }
      };

      const [positiveResults, negativeResults] = await Promise.all([
        Promise.all(positiveRows.map((r) => toBase64(r.photo_url))),
        Promise.all(negativeRows.map((r) => toBase64(r.photo_url))),
      ]);

      galleryExamples = {
        positiveBase64: positiveResults.filter((b): b is string => b !== null),
        negativeBase64: negativeResults.filter((b): b is string => b !== null),
      };
    }
  } catch (err) {
    log.warn('[StepQualityValidation] Failed to load gallery visual examples', { err }, MODULE);
  }

  const { content: messageContent, usedFewShot } = buildMessageContent(step, newPhotoBase64, galleryExamples);

  const requestBody = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [{ role: 'user', content: messageContent }],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);

  let rawContent: string | undefined;
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(`VLM quality check HTTP ${response.status} for ${photo.filename}`, {
        dropNumber: drNumber,
        error: errorText.slice(0, 200),
      }, MODULE);
      return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
    }

    const data = await response.json();
    rawContent = data.choices?.[0]?.message?.content;
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    log.warn(`VLM quality check fetch failed for ${photo.filename}`, {
      dropNumber: drNumber,
      error: isTimeout ? 'timeout' : errMessage(err),
    }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }

  if (!rawContent) {
    log.warn(`Empty VLM response for quality check: ${photo.filename}`, { dropNumber: drNumber }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }

  const cleaned = stripThinkTags(rawContent);
  const jsonMatch =
    cleaned.match(/```json\n([\s\S]*?)\n```/) ||
    cleaned.match(/```\n([\s\S]*?)\n```/);
  const jsonText = jsonMatch?.[1] ?? cleaned;

  let parsed: { passes?: unknown; fail_reason?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    log.warn(`VLM quality check returned malformed JSON for ${photo.filename}`, {
      dropNumber: drNumber,
      error: errMessage(err),
      rawPreview: rawContent.slice(0, 200),
    }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }

  const passes = parsed.passes === true;
  const failReason =
    typeof parsed.fail_reason === 'string' && parsed.fail_reason.length > 0
      ? parsed.fail_reason
      : null;

  log.info(
    `Step ${step} quality check [${usedFewShot ? 'few-shot' : 'text-only'}]: ${photo.filename} → ${passes ? 'PASS' : `FAIL (${failReason})`}`,
    { dropNumber: drNumber },
    MODULE
  );

  return { filename: photo.filename, step, passes, failReason, checkFailed: false };
}

/**
 * Validate categorized photos against per-step visual quality criteria.
 *
 * Only processes steps in QUALITY_CHECK_STEPS (1, 2, 5, 7, 8, 9, 10).
 * Step 6 is excluded — handled by validateOntBackCables.
 *
 * Returns a map of filename → result.
 * When checkFailed=true the caller must preserve the original decision.
 */
export async function validateStepQuality(
  drNumber: string,
  photos: Array<{ filename: string; url: string; step: number }>
): Promise<Map<string, StepQualityCheckResult>> {
  const results = new Map<string, StepQualityCheckResult>();
  if (photos.length === 0) return results;

  log.info(
    `Running step quality check (visual few-shot) on ${photos.length} photo(s) for ${drNumber}`,
    undefined,
    MODULE
  );

  const CONCURRENCY = 2;
  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => checkOnePhoto(drNumber, p)));
    for (const r of batchResults) {
      results.set(r.filename, r);
    }
  }

  const failedCount = Array.from(results.values()).filter((r) => !r.checkFailed && !r.passes).length;
  const errorCount = Array.from(results.values()).filter((r) => r.checkFailed).length;

  log.info(
    `Step quality check complete for ${drNumber}: ${failedCount} failed criteria, ${errorCount} check error(s)`,
    undefined,
    MODULE
  );

  return results;
}
