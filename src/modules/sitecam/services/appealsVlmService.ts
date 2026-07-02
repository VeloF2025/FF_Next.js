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

// Placeholder — real serial-appeal logic lands in Task 4 (which renames the
// param to `input` and uses it). Underscore avoids an unused-param lint error
// in this intermediate commit.
async function evaluateSerialAppeal(_input: AppealInput): Promise<AppealEvaluation> {
  return uncertain('Serial-appeal mode not yet implemented', 'unreadable_image', null);
}

/** Entry point: dispatch to serial mode when the appeal carries serial fields, else photo mode. */
export async function evaluateAppeal(input: AppealInput): Promise<AppealEvaluation> {
  if (!input.photoBase64 || input.photoBase64.trim().length === 0) {
    return uncertain('Appeal has no photo to evaluate', 'no_photo');
  }
  const isSerial = !!(input.serialScanned || input.serialExpected);
  return isSerial ? evaluateSerialAppeal(input) : evaluatePhotoAppeal(input);
}
