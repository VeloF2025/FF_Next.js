import {
  VLM_CHAT_ENDPOINT,
  VLM_QA_MODEL,
  VLM_MAX_TOKENS_QA,
  VLM_TIMEOUT_QA,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';
import { log } from '@/lib/logger';
import {
  buildVlmFewShotPrompt,
  getVlmFewShotExamples,
} from '@/services/vlmLearningService';
import type { VlmAnalysisType } from '@/types/vlm-learning';
import type { VlmSlotResult } from '../types/works-qa.types';
import { SLOT_META } from '../utils/slot-keys';

interface VlmValidateParams {
  photoUrl: string;
  slotKey: string;
  stepLabel: string;
  vlmCheck: string;
}

export const FALLBACK_RESULT: VlmSlotResult = {
  valid: false,
  confidence: 0,
  feedback: 'VLM validation failed — manual review required',
};

/**
 * True when a result is the fetch/parse fallback — i.e. the VLM produced no
 * real verdict (service down, timeout, unparseable response). Callers MUST NOT
 * persist a fallback as a real score (`{valid:false, scored:true}`): that would
 * stick an unscored photo as a permanent red "VLM fail". Persist a pending
 * marker (`{scored:false}`) instead so it is re-scored on a later run. This is
 * the single source of truth for the sentinel — never re-type the string.
 */
export function isVlmFallback(result: VlmSlotResult): boolean {
  return result.confidence === 0 && result.feedback === FALLBACK_RESULT.feedback;
}

/**
 * Strip VLM_PROXY_SECRET out of text bound for a log.
 *
 * Not logging `photoUrl` ourselves is not enough: when vLLM cannot read an image it
 * quotes the URL it tried back at us, secret and all, inside its own error body —
 *   VLM HTTP 500: {"error":{"message":"404, message='Not Found',
 *                  url='https://…/photo-proxy?key=…&vlm=true&vlmkey=<SECRET>'"}}
 * so the secret rides in on `err.message` unless it is scrubbed here. photoProxyAuth
 * accepts the secret appearing in velo's on-box nginx access log; that is a narrower
 * exposure than the application log, which is shipped and read far more widely.
 */
export function redactVlmKey(text: string): string {
  // `%3D` as well as `=`: the observed leak quotes the URL unencoded, but anything that
  // re-encodes it on the way (a redirect Location header, a proxy's own error text)
  // would otherwise slip straight past a `=`-only pattern.
  return text.replace(/(vlmkey(?:=|%3D))[^&'"\s]+/gi, '$1[REDACTED]');
}

export function worksQaAnalysisTypeForSlot(slotKey: string): VlmAnalysisType | null {
  const discipline = SLOT_META.find(slot => slot.key === slotKey)?.discipline;
  if (discipline === 'civil') return 'works_qa_civil';
  if (discipline === 'dome' || discipline === 'main_joint') return 'works_qa_optical';
  return null;
}

async function getWorksQaLearningSection(slotKey?: string): Promise<string> {
  const analysisTypes: VlmAnalysisType[] = slotKey
    ? [worksQaAnalysisTypeForSlot(slotKey)].filter(
        (value): value is VlmAnalysisType => value !== null
      )
    : ['works_qa_civil', 'works_qa_optical'];

  if (analysisTypes.length === 0) return '';

  const examples = (
    await Promise.all(
      analysisTypes.map(analysisType =>
        getVlmFewShotExamples({
          module: 'works_qa',
          analysisType,
          context: slotKey ? { slotKey } : undefined,
          maxExamples: slotKey ? 4 : 2,
        })
      )
    )
  ).flat();

  return buildVlmFewShotPrompt(examples);
}

export async function validatePhotoWithVlm(
  params: VlmValidateParams,
): Promise<VlmSlotResult> {
  const { photoUrl, slotKey, stepLabel, vlmCheck } = params;
  const learningSection = await getWorksQaLearningSection(slotKey);

  const prompt = `You are a fibre network construction QA inspector.
Evaluate whether this photo correctly shows: ${stepLabel}.

What to check: ${vlmCheck}
${learningSection ? `\n${learningSection}\n` : ''}

Respond with ONLY valid JSON (no markdown):
{"valid": true/false, "confidence": 0.0-1.0, "feedback": "brief reason"}`;

  const body = {
    model: VLM_QA_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: photoUrl } },
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_QA,
    temperature: VLM_TEMPERATURE,
  };

  let raw: string;
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VLM_TIMEOUT_QA),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`VLM HTTP ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    raw = json.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    // Spell the error out field by field. `{ err }` serialises an Error to `{}` —
    // its properties are non-enumerable — so the previous log said only
    // "fetch failed" with an empty object, and an HTTP error thrown above (vLLM
    // reporting it could not read the image) was indistinguishable from the socket
    // never opening. 11 054 such lines over 6 days named neither the status nor the
    // 401 behind it. `cause` carries undici's real reason (ECONNREFUSED, DNS, TLS).
    log.error('worksQaVlmService: VLM call failed', {
      slotKey,
      endpoint: VLM_CHAT_ENDPOINT,
      // Never log photoUrl itself — it carries VLM_PROXY_SECRET in the query string.
      photoUrlAuthorized: photoUrl.includes('vlmkey='),
      name: err instanceof Error ? err.name : typeof err,
      message: redactVlmKey(err instanceof Error ? err.message : String(err)),
      cause: err instanceof Error && err.cause ? redactVlmKey(String(err.cause)) : undefined,
    });
    return FALLBACK_RESULT;
  }

  const cleaned = stripThinkTags(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    log.error('worksQaVlmService: no JSON found in VLM response', {
      slotKey,
      raw: cleaned.slice(0, 300),
    });
    return FALLBACK_RESULT;
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      valid?: unknown;
      confidence?: unknown;
      feedback?: unknown;
    };

    if (typeof parsed.valid !== 'boolean') {
      log.error('worksQaVlmService: invalid valid field type', {
        slotKey,
        validType: typeof parsed.valid,
      });
      return FALLBACK_RESULT;
    }
    const valid = parsed.valid;
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const feedback =
      typeof parsed.feedback === 'string' && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : valid
          ? 'Photo meets requirement'
          : 'Photo does not meet requirement';

    return { valid, confidence, feedback };
  } catch (err) {
    log.error('worksQaVlmService: JSON parse failed', {
      slotKey,
      match: redactVlmKey(match[0].slice(0, 300)),
      name: err instanceof Error ? err.name : typeof err,
      message: redactVlmKey(err instanceof Error ? err.message : String(err)),
    });
    return FALLBACK_RESULT;
  }
}

export interface VlmClassifyResult {
  slot_key: string | null;
  confidence: number;
  reasoning: string;
}

const CLASSIFY_FALLBACK: VlmClassifyResult = {
  slot_key: null,
  confidence: 0,
  reasoning: 'VLM classification failed — photo stays unassigned',
};

const SLOT_KEY_SET = new Set(SLOT_META.map(s => s.key));

function buildClassifyPrompt(): string {
  const list = SLOT_META
    .map(s => `- ${s.key} (${s.label}): ${s.vlmCheck}`)
    .join('\n');
  return `You are a fibre network construction QA inspector.
A field worker uploaded a photo for a pole installation. Decide which
of the following slots it belongs to. Pick exactly one slot key.

Available slots:
${list}

If the photo doesn't clearly fit any slot, return slot_key: null.

Respond with ONLY valid JSON (no markdown):
{"slot_key": "<one of the keys above or null>", "confidence": 0.0-1.0, "reasoning": "brief reason"}`;
}

export async function classifyPhotoToSlot(photoUrl: string): Promise<VlmClassifyResult> {
  const learningSection = await getWorksQaLearningSection();
  const prompt = `${buildClassifyPrompt()}${learningSection ? `\n\n${learningSection}` : ''}`;

  const body = {
    model: VLM_QA_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: photoUrl } },
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_QA,
    temperature: VLM_TEMPERATURE,
  };

  let raw: string;
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VLM_TIMEOUT_QA),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`VLM HTTP ${response.status}: ${errText}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    raw = json.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    // Same masking bug as validatePhotoWithVlm above — `{ err }` on an Error logs `{}`.
    log.error('worksQaVlmService.classify: VLM call failed', {
      endpoint: VLM_CHAT_ENDPOINT,
      photoUrlAuthorized: photoUrl.includes('vlmkey='),
      name: err instanceof Error ? err.name : typeof err,
      message: redactVlmKey(err instanceof Error ? err.message : String(err)),
      cause: err instanceof Error && err.cause ? redactVlmKey(String(err.cause)) : undefined,
    });
    return CLASSIFY_FALLBACK;
  }

  const cleaned = stripThinkTags(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    log.error('worksQaVlmService.classify: no JSON in VLM response', {
      raw: cleaned.slice(0, 300),
    });
    return CLASSIFY_FALLBACK;
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      slot_key?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    const slotRaw = parsed.slot_key;
    const slot_key =
      typeof slotRaw === 'string' && SLOT_KEY_SET.has(slotRaw) ? slotRaw : null;
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'no reasoning provided';
    return { slot_key, confidence: slot_key ? confidence : 0, reasoning };
  } catch (err) {
    log.error('worksQaVlmService.classify: JSON parse failed', {
      match: redactVlmKey(match[0].slice(0, 300)),
      name: err instanceof Error ? err.name : typeof err,
      message: redactVlmKey(err instanceof Error ? err.message : String(err)),
    });
    return CLASSIFY_FALLBACK;
  }
}
