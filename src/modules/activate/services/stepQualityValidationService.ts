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

/**
 * A quality check that never completes must NOT silently preserve a PASS — a
 * transient VLM outage would otherwise auto-approve bad photos and (via the
 * auto-feedback cron) tell the technician they passed. So each call is retried,
 * and only when every attempt fails does the check report `checkFailed` — which
 * the caller turns into "hold this DR for human review", not an auto-pass.
 */
export const QUALITY_CHECK_MAX_ATTEMPTS = 3; // 1 initial try + 2 retries
const QUALITY_CHECK_BACKOFF_MS = [500, 1500];

/** Real wall-clock backoff; overridable in tests so retries don't add delay. */
export type SleepFn = (ms: number) => Promise<void>;
const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Outcome of a single VLM quality-check call. `ok:false` is a transient failure
 * (HTTP error, timeout, empty body, malformed JSON) — worth retrying before
 * giving up and holding the DR.
 */
type VlmCallOutcome =
  | { ok: true; passes: boolean; failReason: string | null }
  | { ok: false; reason: string };

/** One VLM request/parse cycle. Never throws; transient failures are returned. */
async function callVlmQualityCheck(
  step: QualityCheckStep,
  messageContent: ReturnType<typeof buildMessageContent>['content'],
): Promise<VlmCallOutcome> {
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
      return { ok: false, reason: `HTTP ${response.status}: ${errorText.slice(0, 120)}` };
    }
    const data = await response.json();
    rawContent = data.choices?.[0]?.message?.content;
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : errMessage(err) };
  }

  if (!rawContent) return { ok: false, reason: 'empty response' };

  const cleaned = stripThinkTags(rawContent);
  const jsonMatch =
    cleaned.match(/```json\n([\s\S]*?)\n```/) ||
    cleaned.match(/```\n([\s\S]*?)\n```/);
  const jsonText = jsonMatch?.[1] ?? cleaned;

  let parsed: { passes?: unknown; fail_reason?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, reason: `malformed JSON: ${errMessage(err)} — ${rawContent.slice(0, 120)}` };
  }

  const passes = parsed.passes === true;
  // Free-text reason from the VLM; fall back to the canned per-step reason on
  // fail so auto-QA comments are never empty.
  const failReason =
    typeof parsed.fail_reason === 'string' && parsed.fail_reason.trim().length > 0
      ? parsed.fail_reason.trim()
      : passes
        ? null
        : STEP_CRITERIA[step].failReason;

  return { ok: true, passes, failReason };
}

async function checkOnePhoto(
  drNumber: string,
  photo: { filename: string; url: string; step: number },
  galleryCache: GalleryCache,
  sleep: SleepFn = realSleep,
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

  // Retry the VLM call before giving up: a transient failure must never be
  // allowed to silently pass a photo (that's what auto-approved bad work).
  let lastReason = 'unknown';
  for (let attempt = 0; attempt < QUALITY_CHECK_MAX_ATTEMPTS; attempt++) {
    const outcome = await callVlmQualityCheck(step, messageContent);
    if (outcome.ok) {
      log.info(
        `Step ${step} quality check [${usedFewShot ? 'few-shot' : 'text-only'}]${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}: ${photo.filename} → ${outcome.passes ? 'PASS' : `FAIL (${outcome.failReason})`}`,
        { dropNumber: drNumber },
        MODULE
      );
      return { filename: photo.filename, step, passes: outcome.passes, failReason: outcome.failReason, checkFailed: false };
    }
    lastReason = outcome.reason;
    log.warn(
      `VLM quality check attempt ${attempt + 1}/${QUALITY_CHECK_MAX_ATTEMPTS} failed for ${photo.filename}: ${lastReason}`,
      { dropNumber: drNumber },
      MODULE
    );
    if (attempt < QUALITY_CHECK_MAX_ATTEMPTS - 1) {
      await sleep(QUALITY_CHECK_BACKOFF_MS[attempt] ?? 1500);
    }
  }

  // Every attempt failed — the check is INCONCLUSIVE, not a pass. checkFailed
  // tells the caller to hold the DR for human review instead of auto-approving.
  log.warn(
    `Step ${step} quality check could NOT complete for ${photo.filename} after ${QUALITY_CHECK_MAX_ATTEMPTS} attempts (${lastReason}) — holding DR for human review`,
    { dropNumber: drNumber },
    MODULE
  );
  return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
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
  photos: Array<{ filename: string; url: string; step: number }>,
  opts: { sleep?: SleepFn } = {}
): Promise<Map<string, StepQualityCheckResult>> {
  const results = new Map<string, StepQualityCheckResult>();
  if (photos.length === 0) return results;

  const sleep = opts.sleep ?? realSleep;

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
    const batchResults = await Promise.all(batch.map((p) => checkOnePhoto(drNumber, p, galleryCache, sleep)));
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
