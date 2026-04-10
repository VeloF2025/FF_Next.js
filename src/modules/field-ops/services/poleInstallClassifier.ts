/**
 * Pole Install Classifier Service
 *
 * Classifies pole installation photos using the VLM (Qwen3-VL-8B) and extracts
 * pole numbers from text messages. Designed for the field-ops WhatsApp photo
 * pipeline where technicians send sequential installation step photos.
 *
 * @module field-ops/services/poleInstallClassifier
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('poleInstallClassifier');
const VLM_URL = process.env.VLM_API_URL || process.env.VLM_SERVICE_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-32B-Instruct-AWQ';
const VLM_TIMEOUT_MS = 30_000;

// ============================================================================
// Types
// ============================================================================

export type PoleInstallStep =
  | 'BEFORE'
  | 'DURING'
  | 'DEPTH'
  | 'ENDPLATE'
  | 'COMPACTION'
  | 'LEVEL'
  | 'STUMPING'
  | 'HOUSEKEEPING'
  | 'SIGNATURE'
  | 'UNKNOWN';

export interface PoleClassification {
  step: PoleInstallStep;
  pole_number: string | null;
  confidence: number;
  quality_ok: boolean;
  issues: string[];
  feedback: string;
}

/** Raw shape returned from VLM JSON response */
interface RawVlmResponse {
  step?: string;
  pole_number?: string | null;
  confidence?: number;
  quality_ok?: boolean;
  issues?: string[];
  feedback?: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_STEPS: ReadonlySet<string> = new Set<PoleInstallStep>([
  'BEFORE',
  'DURING',
  'DEPTH',
  'ENDPLATE',
  'COMPACTION',
  'LEVEL',
  'STUMPING',
  'HOUSEKEEPING',
  'SIGNATURE',
  'UNKNOWN',
]);

const FALLBACK_CLASSIFICATION: PoleClassification = {
  step: 'UNKNOWN',
  pole_number: null,
  confidence: 0,
  quality_ok: false,
  issues: ['VLM unavailable — manual classification required'],
  feedback: 'AI classification unavailable',
};

// ============================================================================
// Prompt Builder
// ============================================================================

function buildClassificationPrompt(poleHint?: string): string {
  const poleLabel = poleHint || 'UNKNOWN';
  return `You are a construction QA inspector for fiber pole installations.
This photo was sent by a field team installing pole ${poleLabel}.

Classify this photo into EXACTLY ONE of these installation steps:
- BEFORE: Marked ground (circle/square/X) showing where hole will be dug. Open ground, paint marks.
- DURING: Staff digging hole or hole being prepared. Shovel/pick visible.
- DEPTH: Measuring tape or ruler placed IN the hole showing depth measurement.
- ENDPLATE: End plates, metal fittings, tags, or identification on the pole. Close-up or medium shot showing pole hardware, CCA H4 tags, labels, metal inserts, rust rings. If the photo is taken close to the pole showing surface detail — this is ENDPLATE.
- COMPACTION: Sand+cement backfill mix around pole base, being compacted. NOT a loose heap.
- LEVEL: Spirit level (bubble level) held against an upright pole.
- STUMPING: Pole being planted/erected into hole, or freshly planted pole WIDE shot from distance (3m+). Full pole visible base to top. If close-up showing hardware/tags, use ENDPLATE instead.
- HOUSEKEEPING: Clean site around a completed pole installation. Cleanup in progress or done.
- SIGNATURE: Sign-off sheet, contractor signature, or completion document on paper.

Also extract any visible pole number (chalk/spray paint on pole, written labels, stickers).

Respond with ONLY this JSON (no markdown, no explanation):
{"step":"STEP_NAME","pole_number":"extracted or null","confidence":0.85,"quality_ok":true,"issues":[],"feedback":"one sentence"}`;
}

// ============================================================================
// Response Parser
// ============================================================================

function parseClassificationResponse(text: string): PoleClassification {
  try {
    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as RawVlmResponse;
      const rawStep = typeof raw.step === 'string' ? raw.step.toUpperCase() : 'UNKNOWN';
      const step: PoleInstallStep = VALID_STEPS.has(rawStep)
        ? (rawStep as PoleInstallStep)
        : 'UNKNOWN';

      return {
        step,
        pole_number: raw.pole_number ? String(raw.pole_number) : null,
        confidence: Math.min(1, Math.max(0, Number(raw.confidence ?? 0))),
        quality_ok: Boolean(raw.quality_ok ?? false),
        issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
        feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
      };
    }
  } catch (parseError) {
    logger.warn('Failed to parse VLM JSON response', {
      error: parseError instanceof Error ? parseError.message : 'Unknown',
      responsePreview: text.slice(0, 200),
    });
  }

  // Fallback: extract step keyword from free-form text
  const upper = text.toUpperCase();
  const detectedStep = (
    ['BEFORE', 'DURING', 'DEPTH', 'ENDPLATE', 'COMPACTION', 'LEVEL', 'STUMPING', 'HOUSEKEEPING', 'SIGNATURE'] as PoleInstallStep[]
  ).find((s) => upper.includes(s));

  return {
    step: detectedStep ?? 'UNKNOWN',
    pole_number: null,
    confidence: detectedStep ? 0.3 : 0,
    quality_ok: false,
    issues: ['Could not parse structured AI response — manual review recommended'],
    feedback: text.slice(0, 300),
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Classify a pole installation photo using the VLM.
 *
 * @param photoBase64 - Raw base64-encoded JPEG/PNG image data (no data URI prefix)
 * @param poleHint - Optional pole number hint for the prompt (e.g. "LAW.P.A0042")
 * @returns Classification result including step, confidence, and extracted pole number
 */
export async function classifyPolePhoto(
  photoBase64: string,
  poleHint?: string
): Promise<PoleClassification> {
  const imageDataUrl = `data:image/jpeg;base64,${photoBase64}`;
  const prompt = buildClassificationPrompt(poleHint);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`VLM HTTP ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';

    if (!text) {
      throw new Error('VLM returned empty content');
    }

    const result = parseClassificationResponse(text);

    logger.info('Pole photo classified', {
      step: result.step,
      confidence: result.confidence,
      poleHint,
      extractedPole: result.pole_number,
    });

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('VLM classification timed out', { poleHint, timeoutMs: VLM_TIMEOUT_MS });
      return {
        ...FALLBACK_CLASSIFICATION,
        issues: [`VLM request timed out after ${VLM_TIMEOUT_MS / 1000}s`],
        feedback: 'AI classification timed out — manual review required',
      };
    }

    logger.error('VLM classification failed', {
      error: error instanceof Error ? error.message : 'Unknown',
      poleHint,
    });

    return {
      ...FALLBACK_CLASSIFICATION,
      issues: [`VLM error: ${error instanceof Error ? error.message : 'Unknown'}`],
      feedback: 'AI classification failed — manual review required',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract a pole number from a WhatsApp text message using regex patterns.
 *
 * Handles formats like:
 * - "Starting pole: LAW.P.A0042"
 * - "LAW-P-A0042"
 * - "Pole A003"
 * - "Begin LAW.PA042"
 *
 * @param messageText - Raw WhatsApp message text
 * @returns Normalised pole number string, or null if not found
 */
export function extractPoleFromText(messageText: string): string | null {
  const patterns: RegExp[] = [
    // Explicit keyword prefix: "pole: LAW.P.A0042" or "starting LAW.P.A0042"
    /(?:pole|starting|begin|start)\s*:?\s*([A-Z]{2,4}\.?P\.?[A-Z]?\d{1,4})/i,
    // General pole number format: "LAW-P-A0042" or "LAW.P.A0042"
    /\b([A-Z]{2,4}[.-]P[.-][A-Z]\d{2,4})\b/i,
    // Bare short pole number: "A003"
    /\b([A-Z]\d{3})\b/,
  ];

  for (const pattern of patterns) {
    const match = messageText.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}
