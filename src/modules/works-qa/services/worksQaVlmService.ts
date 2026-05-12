import {
  VLM_CHAT_ENDPOINT,
  VLM_QA_MODEL,
  VLM_MAX_TOKENS_QA,
  VLM_TIMEOUT_QA,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';
import { log } from '@/lib/logger';
import type { VlmSlotResult } from '../types/works-qa.types';

interface VlmValidateParams {
  photoUrl: string;
  slotKey: string;
  stepLabel: string;
  vlmCheck: string;
}

const FALLBACK_RESULT: VlmSlotResult = {
  valid: false,
  confidence: 0,
  feedback: 'VLM validation failed — manual review required',
};

export async function validatePhotoWithVlm(
  params: VlmValidateParams,
): Promise<VlmSlotResult> {
  const { photoUrl, slotKey, stepLabel, vlmCheck } = params;

  const prompt = `You are a fibre network construction QA inspector.
Evaluate whether this photo correctly shows: ${stepLabel}.

What to check: ${vlmCheck}

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
    log.error('worksQaVlmService: fetch failed', { slotKey, err });
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

    const valid = Boolean(parsed.valid);
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
      match: match[0].slice(0, 300),
      err,
    });
    return FALLBACK_RESULT;
  }
}
