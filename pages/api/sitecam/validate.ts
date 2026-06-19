/**
 * POST /api/sitecam/validate
 *
 * Validates a single photo for a PWA job step.
 * Runs two fraud checks then a VLM quality check:
 *  1. EXIF age — photo must be < 2 hours old (warn-only if no EXIF)
 *  2. Duplicate hash — same base64 for this site already rejected
 *  3. VLM step quality — uses same criteria as auto-QA
 *
 * Returns { pass, reasons, corrections, stepLabel, attemptNumber, maxAttempts }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import {
  STEP_CRITERIA,
  QUALITY_CHECK_STEPS,
  buildMessageContent,
  type QualityCheckStep,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  CIVIL_STEP_CRITERIA,
  CIVIL_QUALITY_STEPS,
  buildCivilMessageContent,
  type CivilStep,
} from '@/modules/sitecam/lib/civilStepCriteria';
import { toGalleryJobType, type SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import { loadGalleryExamples } from '@/lib/vlmGallery';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  VLM_MAX_IMAGE_WIDTH,
  VLM_MAX_IMAGE_HEIGHT,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'PwaValidate';
const MAX_ATTEMPTS = 3;

interface ValidateBody {
  jobType: SiteCamJobType;
  stepNumber: number;
  siteId: string;
  photoBase64: string;
  attemptNumber: number;
  exifTimestamp?: string;
}

interface VlmResult {
  pass: boolean;
  reasons: string[];
  corrections: string[];
  /** True when pass is the result of failing open (VLM unavailable), not a real check. */
  needsManualReview: boolean;
}

function hashBase64(b64: string): string {
  return createHash('sha256').update(b64).digest('hex');
}

async function isDuplicatePhoto(siteId: string, hash: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pwa_photo_hashes WHERE site_id = $1 AND photo_hash = $2 LIMIT 1`,
    [siteId, hash]
  );
  return rows.length > 0;
}

async function recordPhotoHash(siteId: string, stepNumber: number, hash: string): Promise<void> {
  await pool.query(
    `INSERT INTO pwa_photo_hashes (site_id, step_number, photo_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [siteId, stepNumber, hash]
  );
}

function checkExifAge(exifTimestamp: string | undefined): { ok: boolean; reason?: string } {
  if (!exifTimestamp) return { ok: true };
  const exif = new Date(exifTimestamp).getTime();
  if (isNaN(exif)) {
    // Unparsable client-supplied timestamp — accept (don't block) but surface
    // it, since a garbage value would otherwise silently skip the age check.
    log.warn('Unparsable exifTimestamp received — skipping EXIF age check', { exifTimestamp }, MODULE);
    return { ok: true };
  }
  const twoHours = 2 * 60 * 60 * 1000;
  if (Math.abs(Date.now() - exif) > twoHours) {
    return {
      ok: false,
      reason: 'Photo was taken more than 2 hours ago. Please retake with a fresh photo.',
    };
  }
  return { ok: true };
}

async function runVlmCheck(
  jobType: SiteCamJobType,
  step: number,
  rawPhotoBase64: string
): Promise<VlmResult> {
  const galleryExamples = await loadGalleryExamples(step, toGalleryJobType(jobType));

  // Phone photos arrive at full camera resolution; together with the gallery
  // examples they exceed the VLM's 32k context and every request 400s (and
  // fails open). The JUDGED photo gets the larger budget (1280×960) — the small
  // features that decide a step (a wall hole, 4 LEDs, a meter reading) only
  // survive at higher resolution — while gallery examples are downscaled
  // smaller (see vlmGallery.ts), so total context stays below where it 400'd.
  const photoBase64 = await optimizeForVlm(rawPhotoBase64, {
    maxWidth: VLM_MAX_IMAGE_WIDTH,
    maxHeight: VLM_MAX_IMAGE_HEIGHT,
  });

  let content: unknown[];
  if (jobType === 'civils') {
    const { content: c } = buildCivilMessageContent(step as CivilStep, photoBase64, galleryExamples);
    content = c;
  } else {
    const { content: c } = buildMessageContent(step as QualityCheckStep, photoBase64, galleryExamples);
    content = c;
  }

  const body = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [{ role: 'user', content }],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);
  try {
    const resp = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = stripThinkTags(json.choices?.[0]?.message?.content ?? '');
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        pass?: boolean;
        passes?: boolean;
        fail_reason?: string | null;
        reasons?: string[];
        corrections?: string[];
      };
      // VLM may return either "pass" or "passes" depending on prompt variant
      const passed = parsed.passes !== undefined ? parsed.passes === true : parsed.pass === true;
      // Free-text reason from the VLM; fall back to the canned per-step reason
      // so a failed photo never reaches the technician with no explanation.
      const cannedReason = jobType === 'civils'
        ? CIVIL_STEP_CRITERIA[step as CivilStep].failReason
        : STEP_CRITERIA[step as QualityCheckStep].failReason;
      const failReason =
        (typeof parsed.fail_reason === 'string' && parsed.fail_reason.trim().length > 0
          ? parsed.fail_reason.trim()
          : null) ?? (passed ? null : cannedReason);
      return {
        pass: passed,
        reasons: passed || !failReason
          ? (Array.isArray(parsed.reasons) ? parsed.reasons : [])
          : [failReason],
        corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
        needsManualReview: false,
      };
    }
    // No JSON in response — fail open to avoid blocking tech on parse errors,
    // but log at error level so an operator is alerted that VLM is degraded.
    log.error('VLM returned no parsable JSON — failing open (photo auto-passed)', { raw: raw.slice(0, 200) }, MODULE);
    return { pass: true, reasons: [], corrections: [], needsManualReview: true };
  } catch (err) {
    clearTimeout(timeout);
    // Fail open so a VLM outage never blocks a technician — but log at error
    // level (Sentry) so the outage is visible and photos can be re-reviewed.
    log.error('VLM validation failed — failing open (photo auto-passed)', { error: String(err) }, MODULE);
    return { pass: true, reasons: [], corrections: [], needsManualReview: true };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse, _session: AttendanceSession): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { jobType, stepNumber, siteId, photoBase64, attemptNumber, exifTimestamp } =
    (req.body ?? {}) as Partial<ValidateBody>;

  if (!jobType || stepNumber == null || !siteId || !photoBase64 || attemptNumber == null) {
    return apiResponse.badRequest(res, 'jobType, stepNumber, siteId, photoBase64, attemptNumber required');
  }

  if (jobType !== 'activations' && jobType !== 'civils') {
    return apiResponse.badRequest(res, 'jobType must be "activations" or "civils"');
  }

  // siteId is a DR/pole identifier used as a DB key — bound its length and charset.
  if (siteId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(siteId)) {
    return apiResponse.badRequest(res, 'Invalid siteId format');
  }

  // Validate step number and resolve step label based on jobType
  let stepLabel: string;
  if (jobType === 'civils') {
    if (!(CIVIL_QUALITY_STEPS as readonly number[]).includes(stepNumber)) {
      return apiResponse.badRequest(res, `Step ${stepNumber} has no VLM validation criteria`);
    }
    stepLabel = CIVIL_STEP_CRITERIA[stepNumber as CivilStep].label;
  } else {
    if (!(QUALITY_CHECK_STEPS as readonly number[]).includes(stepNumber)) {
      return apiResponse.badRequest(res, `Step ${stepNumber} has no VLM validation criteria`);
    }
    stepLabel = STEP_CRITERIA[stepNumber as QualityCheckStep].label;
  }

  // Fraud: EXIF age check
  const ageCheck = checkExifAge(exifTimestamp);
  if (!ageCheck.ok) {
    return apiResponse.success(res, {
      pass: false,
      reasons: [ageCheck.reason!],
      corrections: ['Please take a fresh photo right now at the installation site.'],
      stepLabel,
      attemptNumber,
      maxAttempts: MAX_ATTEMPTS,
      fraudDetected: 'exif_age',
    });
  }

  // Fraud: duplicate photo check
  const hash = hashBase64(photoBase64);
  const duplicate = await isDuplicatePhoto(siteId, hash);
  if (duplicate) {
    return apiResponse.success(res, {
      pass: false,
      reasons: ['This exact photo has already been submitted for this job.'],
      corrections: ['Take a new photo — do not reuse a previously submitted photo.'],
      stepLabel,
      attemptNumber,
      maxAttempts: MAX_ATTEMPTS,
      fraudDetected: 'duplicate_hash',
    });
  }

  // VLM quality check
  const result = await runVlmCheck(jobType, stepNumber, photoBase64);

  // Record hash regardless of outcome (prevents reuse on retries). A failure
  // here silently disables duplicate detection for this site, so surface it.
  await recordPhotoHash(siteId, stepNumber, hash).catch((err: unknown) => {
    log.error('Failed to record photo hash — duplicate detection degraded', { error: String(err) }, MODULE);
  });

  return apiResponse.success(res, {
    pass: result.pass,
    reasons: result.reasons,
    corrections: result.corrections,
    needsManualReview: result.needsManualReview,
    stepLabel,
    attemptNumber,
    maxAttempts: MAX_ATTEMPTS,
  });
}

export default withMySession(handler);

export const config = {
  // photoBase64 is a full camera image — raise the body limit above the 1mb default.
  api: { bodyParser: { sizeLimit: '15mb' } },
};
