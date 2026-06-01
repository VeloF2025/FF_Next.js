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
import { withAuth } from '@/lib/auth';
import {
  STEP_CRITERIA,
  QUALITY_CHECK_STEPS,
  buildMessageContent,
  type QualityCheckStep,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'PwaValidate';
const MAX_ATTEMPTS = 3;

interface ValidateBody {
  jobType: 'activations' | 'civils';
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
  if (isNaN(exif)) return { ok: true };
  const twoHours = 2 * 60 * 60 * 1000;
  if (Math.abs(Date.now() - exif) > twoHours) {
    return {
      ok: false,
      reason: 'Photo was taken more than 2 hours ago. Please retake with a fresh photo.',
    };
  }
  return { ok: true };
}

async function runVlmCheck(step: QualityCheckStep, photoBase64: string): Promise<VlmResult> {
  const { content } = buildMessageContent(step, photoBase64, undefined);
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
      const parsed = JSON.parse(match[0]) as { pass?: boolean; reasons?: string[]; corrections?: string[] };
      return {
        pass: parsed.pass === true,
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      };
    }
    // No JSON in response — allow pass to avoid blocking tech on parse errors
    return { pass: true, reasons: [], corrections: [] };
  } catch (err) {
    clearTimeout(timeout);
    log.warn('VLM validation failed — allowing pass to avoid blocking technician', { error: String(err) }, MODULE);
    return { pass: true, reasons: [], corrections: [] };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { jobType, stepNumber, siteId, photoBase64, attemptNumber, exifTimestamp } =
    (req.body ?? {}) as Partial<ValidateBody>;

  if (!jobType || stepNumber == null || !siteId || !photoBase64 || attemptNumber == null) {
    return apiResponse.badRequest(res, 'jobType, stepNumber, siteId, photoBase64, attemptNumber required');
  }

  const step = stepNumber as QualityCheckStep;
  if (!(QUALITY_CHECK_STEPS as readonly number[]).includes(step)) {
    return apiResponse.badRequest(res, `Step ${stepNumber} has no VLM validation criteria`);
  }

  // Fraud: EXIF age check
  const ageCheck = checkExifAge(exifTimestamp);
  if (!ageCheck.ok) {
    return apiResponse.success(res, {
      pass: false,
      reasons: [ageCheck.reason!],
      corrections: ['Please take a fresh photo right now at the installation site.'],
      stepLabel: STEP_CRITERIA[step].label,
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
      stepLabel: STEP_CRITERIA[step].label,
      attemptNumber,
      maxAttempts: MAX_ATTEMPTS,
      fraudDetected: 'duplicate_hash',
    });
  }

  // VLM quality check
  const result = await runVlmCheck(step, photoBase64);

  // Record hash regardless of outcome (prevents reuse on retries)
  await recordPhotoHash(siteId, step, hash).catch(() => undefined);

  return apiResponse.success(res, {
    pass: result.pass,
    reasons: result.reasons,
    corrections: result.corrections,
    stepLabel: STEP_CRITERIA[step].label,
    attemptNumber,
    maxAttempts: MAX_ATTEMPTS,
  });
}

export default withAuth(handler);

export const config = {
  // photoBase64 is a full camera image — raise the body limit above the 1mb default.
  api: { bodyParser: { sizeLimit: '15mb' } },
};
