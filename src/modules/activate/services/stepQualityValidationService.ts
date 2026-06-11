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
import { loadGalleryExamples } from '@/lib/vlmGallery';
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

/**
 * Per-step gallery visual examples, base64-encoded. Loaded at most once per
 * step per validation run (see GalleryCache) — checkOnePhoto runs per photo, so
 * without the cache the same step's examples would be re-queried and re-fetched
 * for every photo of that step.
 */
type GalleryCache = Map<number, GalleryExamples | undefined>;

async function checkOnePhoto(
  drNumber: string,
  photo: { filename: string; url: string; step: number },
  galleryCache: GalleryCache
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

  // Gallery-curated visual examples for this step (cached per validation run).
  const cache = galleryCache;
  if (!cache.has(step)) {
    cache.set(step, await loadGalleryExamples(step, 'activation'));
  }
  const galleryExamples = cache.get(step);

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
  // Free-text reason from the VLM; fall back to the canned per-step reason on
  // fail so auto-QA comments are never empty.
  const failReason =
    typeof parsed.fail_reason === 'string' && parsed.fail_reason.trim().length > 0
      ? parsed.fail_reason.trim()
      : passes
        ? null
        : STEP_CRITERIA[step as QualityCheckStep].failReason;

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
 * Only processes steps in QUALITY_CHECK_STEPS (1, 2, 5, 7, 8, 9, 10, 11, 12).
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

  // Gallery examples are loaded at most once per step across the whole run.
  const galleryCache: GalleryCache = new Map();

  const CONCURRENCY = 2;
  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => checkOnePhoto(drNumber, p, galleryCache)));
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
