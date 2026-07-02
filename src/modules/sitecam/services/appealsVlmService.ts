/**
 * Appeals VLM service (shadow mode). Turns a SiteCam appeal into an ADVISORY
 * recommendation. Two modes behind one `evaluateAppeal` entry point:
 *   - photo mode  → reason↔photo consistency + context-aware re-judge
 *   - serial mode → barcode-first read, VLM OCR fallback (Task 4)
 *
 * Fail-open policy is DELIBERATELY the opposite of /api/sitecam/validate: an
 * unavailable/garbled VLM records `uncertain` + a skipReason, NEVER a silent
 * approve. See spec §5.3 / §5.8.
 */
import { log } from '@/lib/logger';
import { loadGalleryExamples } from '@/lib/vlmGallery';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { toGalleryJobType, type SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
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
import type { VlmContentPart } from '@/modules/activate/services/stepQualityCriteria';
import { QUALITY_CHECK_STEPS } from '@/modules/activate/services/stepQualityCriteria';
import { CIVIL_QUALITY_STEPS } from '@/modules/sitecam/lib/civilStepCriteria';
import { buildAppealPhotoContent } from '@/modules/sitecam/lib/appealStepCriteria';
import { extractOntSerialEnhanced } from '@/modules/activate/services/enhancedBarcodeService';

const MODULE = 'AppealsVlm';
/** Bump whenever the appeal prompt changes — recorded in `model` for audit. */
export const APPEAL_PROMPT_VERSION = 'appeal-v1';
const MODEL_TAG = `${VLM_CATEGORIZATION_MODEL}/${APPEAL_PROMPT_VERSION}`;

export type AppealRecommendation = 'approve' | 'deny' | 'uncertain';
export type AppealSkipReason =
  | 'no_photo'
  | 'vlm_unavailable'
  | 'unsupported_step'
  | 'unreadable_image';

export interface AppealCheck {
  name: string;
  verdict: 'pass' | 'fail' | 'uncertain';
  evidence: string;
}

export interface AppealEvaluation {
  recommendation: AppealRecommendation;
  confidence: number; // 0..1
  reasoning: string;
  checks: AppealCheck[];
  serialRead?: string | null; // serial mode only
  model: string;
  skipReason: AppealSkipReason | null;
}

export interface AppealInput {
  jobType: SiteCamJobType;
  stepNumber: number;
  /** Raw base64 (no `data:` prefix) — the cron strips the prefix before calling. */
  photoBase64: string;
  appealText: string;
  serialScanned?: string | null;
  serialExpected?: string | null;
}

/** Advisory "we couldn't decide" result — the only fail path (never approve). */
export function uncertain(reason: string, skip: AppealSkipReason, serialRead?: string | null): AppealEvaluation {
  return {
    recommendation: 'uncertain',
    confidence: 0,
    reasoning: reason,
    checks: [],
    serialRead: serialRead ?? null,
    model: MODEL_TAG,
    skipReason: skip,
  };
}

/** POST content parts to the VLM; return raw (think-tag-stripped) text or null on failure. */
export async function callVlm(content: VlmContentPart[]): Promise<string | null> {
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
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return stripThinkTags(json.choices?.[0]?.message?.content ?? '');
  } catch (err) {
    clearTimeout(timeout);
    log.error('Appeals VLM call failed', { error: String(err) }, MODULE);
    return null;
  }
}

interface RawAppealJson {
  recommendation?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  checks?: unknown;
}

/** Extract the first JSON object from raw VLM text. */
export function parseAppealJson(raw: string): RawAppealJson | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as RawAppealJson;
  } catch {
    return null;
  }
}

function isRecommendation(v: unknown): v is AppealRecommendation {
  return v === 'approve' || v === 'deny' || v === 'uncertain';
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

function isAppealCheck(v: unknown): v is AppealCheck {
  const c = v as AppealCheck;
  return (
    !!c &&
    typeof c.name === 'string' &&
    (c.verdict === 'pass' || c.verdict === 'fail' || c.verdict === 'uncertain') &&
    typeof c.evidence === 'string'
  );
}

function stepHasCriteria(jobType: SiteCamJobType, step: number): boolean {
  const steps = jobType === 'civils' ? CIVIL_QUALITY_STEPS : QUALITY_CHECK_STEPS;
  return (steps as readonly number[]).includes(step);
}

async function evaluatePhotoAppeal(input: AppealInput): Promise<AppealEvaluation> {
  if (!stepHasCriteria(input.jobType, input.stepNumber)) {
    return uncertain(`Step ${input.stepNumber} has no appeal criteria for ${input.jobType}`, 'unsupported_step');
  }

  // Rank gallery examples by visual similarity to the appealed photo, then give
  // the judged photo the larger budget (small edge-case features must survive).
  const gallery = await loadGalleryExamples(input.stepNumber, toGalleryJobType(input.jobType), input.photoBase64);
  const optimized = await optimizeForVlm(input.photoBase64, {
    maxWidth: VLM_MAX_IMAGE_WIDTH,
    maxHeight: VLM_MAX_IMAGE_HEIGHT,
  });

  const content = buildAppealPhotoContent(input.jobType, input.stepNumber, optimized, input.appealText, gallery);
  const raw = await callVlm(content);
  if (raw === null) return uncertain('Appeals VLM unavailable', 'vlm_unavailable');

  const parsed = parseAppealJson(raw);
  if (!parsed || !isRecommendation(parsed.recommendation)) {
    log.error('Appeals VLM returned no parsable recommendation', { raw: raw.slice(0, 200) }, MODULE);
    return uncertain('Appeals VLM returned an unparsable response', 'vlm_unavailable');
  }

  return {
    recommendation: parsed.recommendation,
    confidence: clampConfidence(parsed.confidence),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
    checks: Array.isArray(parsed.checks) ? (parsed.checks.filter(isAppealCheck) as AppealCheck[]) : [],
    serialRead: null,
    model: MODEL_TAG,
    skipReason: null,
  };
}

interface RawSerialJson {
  serial?: unknown;
}

/** VLM OCR fallback: read a serial off the photo when the barcode scan fails. */
async function ocrSerialViaVlm(photoBase64: string): Promise<string | null> {
  const optimized = await optimizeForVlm(photoBase64, {
    maxWidth: VLM_MAX_IMAGE_WIDTH,
    maxHeight: VLM_MAX_IMAGE_HEIGHT,
  });
  const content: VlmContentPart[] = [
    {
      type: 'text',
      text: 'Read the ONT/device serial number printed or barcoded in this photo. Respond with ONLY this JSON: {"serial":"<value>"} or {"serial":null} if you cannot read it clearly.',
    },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${optimized}` } },
  ];
  const raw = await callVlm(content);
  if (raw === null) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as RawSerialJson;
    return typeof parsed.serial === 'string' && parsed.serial.trim().length > 0 ? parsed.serial.trim() : null;
  } catch {
    return null;
  }
}

async function evaluateSerialAppeal(input: AppealInput): Promise<AppealEvaluation> {
  const scanned = (input.serialScanned ?? '').trim().toUpperCase();
  const expected = (input.serialExpected ?? '').trim().toUpperCase();

  // 1. Barcode-first (Data Matrix / Code128) — highest confidence. A thrown
  //    scanner error is treated as a failed read, not a crash.
  const barcode = await extractOntSerialEnhanced(input.photoBase64).catch((err: unknown) => {
    log.error('Barcode scan threw during serial appeal', { error: String(err) }, MODULE);
    return null;
  });
  let serialRead: string | null = barcode?.success ? barcode.serial : null;
  const viaBarcode = serialRead !== null;

  // 2. VLM OCR fallback.
  if (!serialRead) serialRead = await ocrSerialViaVlm(input.photoBase64);

  if (!serialRead) {
    return uncertain('Serial not legible in the appealed photo (barcode + OCR both failed)', 'unreadable_image', null);
  }

  const readNorm = serialRead.trim().toUpperCase();
  const checks: AppealCheck[] = [
    {
      name: 'photo_matches_scanned',
      verdict: readNorm === scanned ? 'pass' : 'fail',
      evidence: `photo serial ${readNorm} vs scanned ${scanned || '(none)'}`,
    },
    {
      name: 'photo_matches_expected',
      verdict: readNorm === expected ? 'pass' : 'fail',
      evidence: `photo serial ${readNorm} vs expected ${expected || '(none)'}`,
    },
  ];

  // Approve when the photo legibly shows the serial the tech scanned — the
  // mismatch is then against the EXPECTED/SOW value (an upstream data issue,
  // not a tech error). Deny when the photo shows a different serial.
  const recommendation: AppealRecommendation = readNorm === scanned ? 'approve' : 'deny';
  const reasoning =
    recommendation === 'approve'
      ? `Photo serial ${readNorm} matches the scanned value; mismatch is against the expected/SOW serial ${expected || '(none)'}.`
      : `Photo serial ${readNorm} does not match the scanned value ${scanned || '(none)'}.`;

  return {
    recommendation,
    confidence: viaBarcode ? 0.95 : 0.7,
    reasoning,
    checks,
    serialRead: readNorm,
    model: MODEL_TAG,
    skipReason: null,
  };
}

/** Entry point: dispatch to serial mode when the appeal carries serial fields, else photo mode. */
export async function evaluateAppeal(input: AppealInput): Promise<AppealEvaluation> {
  if (!input.photoBase64 || input.photoBase64.trim().length === 0) {
    return uncertain('Appeal has no photo to evaluate', 'no_photo');
  }
  const isSerial = !!(input.serialScanned || input.serialExpected);
  return isSerial ? evaluateSerialAppeal(input) : evaluatePhotoAppeal(input);
}
