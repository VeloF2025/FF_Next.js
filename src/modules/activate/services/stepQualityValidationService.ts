/**
 * Step Quality Validation Service
 *
 * Targeted VLM post-check that runs after photo categorization.
 * For each photo assigned to a step, validates that it actually meets
 * the visual quality criteria defined for that step.
 *
 * Uses VISUAL FEW-SHOT prompting: the VLM sees real correct/incorrect
 * reference examples (from the QA team) alongside each new photo, so it
 * can compare visually rather than relying on text criteria alone.
 *
 * Follows the same pattern as ontBackCableValidator.ts.
 * Step 6 is excluded here — handled by validateOntBackCables.
 *
 * On any VLM/network error the original decision is preserved (checkFailed=true),
 * so transient failures never cause false discards.
 */

import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from './photoFetchService';
import { loadStepReferences } from './qaReferencePhotos';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'StepQualityValidator';

/** Steps that have explicit visual quality criteria and receive a VLM check. Step 6 excluded (handled by ontBackCableValidator). */
export const QUALITY_CHECK_STEPS = [1, 2, 5, 7, 8, 9, 10] as const;
export type QualityCheckStep = (typeof QUALITY_CHECK_STEPS)[number];

export interface StepQualityCheckResult {
  filename: string;
  step: number;
  passes: boolean;
  failReason: string | null;
  checkFailed: boolean;
}

// ============================================================================
// PER-STEP TEXT CRITERIA (combined with visual few-shot)
// ============================================================================

interface StepCriteria {
  label: string;
  requirements: string;
  failInstruction: string;
  failReason: string;
}

const STEP_CRITERIA: Record<QualityCheckStep, StepCriteria> = {
  1: {
    label: 'House / Property Photo',
    requirements:
      'The full property (or near-full property) must be visible: at minimum two sides/corners of the building in frame, OR the front face with roof and both edges visible. The roof must be visible and the structure identifiable as a complete building/home/shack/property.',
    failInstruction:
      'FAIL if only one wall or side is visible (shot too close or side-on), if the roof or edges are cut off, or if it is a close-up of only a wall/door/window.',
    failReason: 'Full property not in view',
  },
  2: {
    label: 'Cable from Pole',
    requirements:
      'A utility pole must be clearly visible in the frame. The cable or fiber span crossing through the air is also expected.',
    failInstruction:
      'FAIL if no utility pole is visible anywhere in the frame, even if a cable span is present.',
    failReason: 'The pole is not in view',
  },
  5: {
    label: 'Wall for Installation',
    requirements:
      'BOTH must be present: (1) a wooden board or plank mounted on the wall, AND (2) a wall mount bracket physically attached to that wooden board — acceptable types: white metal rectangular rail/bracket with holes, or a circular/D-ring bracket screwed into the wood.',
    failInstruction:
      'FAIL if there is no wooden board with a bracket visible, if a wooden board is present but has no bracket attached, or if it is just a bare wall with no mount hardware.',
    failReason: 'No wall mount in view',
  },
  7: {
    label: 'Power Meter Reading',
    requirements:
      'A handheld optical power meter device must be visible with its dBm reading clearly legible on screen.',
    failInstruction:
      'FAIL if the display is blurry/dark/overexposed or the numbers cannot be clearly read, or if no power meter device is shown.',
    failReason: 'Power meter reading not clearly visible',
  },
  8: {
    label: 'Final Installation',
    requirements:
      'ALL of the following must be visible in a single wide shot: the white Fibertime/Nokia router, the black ONT box (behind or below the router), cables leading to a power outlet, and the power outlet (wall socket) itself.',
    failInstruction:
      'FAIL if the power outlet/wall socket is NOT visible anywhere in the frame, even if the router, ONT, and cables are all present.',
    failReason: 'Power outlet not in view',
  },
  9: {
    label: 'Green Lights on ONT',
    requirements:
      'The white Fibertime/Nokia router FRONT PANEL must be the main subject, and all 4 indicator lights must be visibly ON and green.',
    failInstruction:
      'FAIL if fewer than 4 lights are active/illuminated on the white router front panel, if the lights are off or not clearly visible, or if only the black ONT box is shown without the white router front panel.',
    failReason: 'Not all lights in view',
  },
  10: {
    label: 'Signature',
    requirements:
      'A visible customer signature must be present on a form, paper, or tablet, and must be recognisable as handwriting/a signature.',
    failInstruction:
      'FAIL if no signature is visible, if the form is blank or the signature area is empty, or if the photo does not show a completed signature.',
    failReason: 'No signature visible',
  },
};

// ============================================================================
// PROMPT BUILDER
// ============================================================================

type VlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Build the VLM message content array for a step quality check.
 * Includes visual reference examples (correct + incorrect) followed by the new photo.
 */
function buildMessageContent(
  step: QualityCheckStep,
  newPhotoBase64: string
): VlmContentPart[] {
  const criteria = STEP_CRITERIA[step];
  const refs = loadStepReferences(step);
  const content: VlmContentPart[] = [];

  if (refs && (refs.correct.length > 0 || refs.incorrect.length > 0)) {
    // --- Visual few-shot mode ---
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a fiber optic installation.

I will first show you REFERENCE EXAMPLES from our QA team, then ask you to evaluate a NEW photo.`,
    });

    if (refs.correct.length > 0) {
      content.push({
        type: 'text',
        text: `CORRECT EXAMPLE${refs.correct.length > 1 ? 'S' : ''} — These are passing "${criteria.label}" photos:`,
      });
      for (const ref of refs.correct) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${ref.base64}` },
        });
      }
    }

    if (refs.incorrect.length > 0) {
      content.push({
        type: 'text',
        text: `INCORRECT EXAMPLE${refs.incorrect.length > 1 ? 'S' : ''} — These are FAILING "${criteria.label}" photos and why:`,
      });
      for (const ref of refs.incorrect) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${ref.base64}` },
        });
        content.push({
          type: 'text',
          text: `↑ INCORRECT because: ${ref.reason}`,
        });
      }
    }

    content.push({
      type: 'text',
      text: `NOW EVALUATE THIS NEW PHOTO — compare it to the reference examples above:`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${newPhotoBase64}` },
    });
    content.push({
      type: 'text',
      text: `Required criteria: ${criteria.requirements}
${criteria.failInstruction}

If it fails, the reason must be exactly: "${criteria.failReason}"

Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "${criteria.failReason}"}`,
    });
  } else {
    // --- Text-only fallback (no reference photos available for this step) ---
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a fiber optic installation.

Required: ${criteria.requirements}
${criteria.failInstruction}

Evaluate this photo:`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${newPhotoBase64}` },
    });
    content.push({
      type: 'text',
      text: `Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "${criteria.failReason}"}`,
    });
  }

  return content;
}

// ============================================================================
// SINGLE PHOTO CHECK
// ============================================================================

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
      error: (err as Error).message,
    }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }

  const messageContent = buildMessageContent(step, newPhotoBase64);
  const usedFewShot = messageContent.some(
    (p) => p.type === 'text' && (p as { type: 'text'; text: string }).text.startsWith('CORRECT EXAMPLE')
  );

  const requestBody = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [{ role: 'user', content: messageContent }],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);

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
    const rawContent: string | undefined = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      log.warn(`Empty VLM response for quality check: ${photo.filename}`, { dropNumber: drNumber }, MODULE);
      return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
    }

    const content = stripThinkTags(rawContent);
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];
    const parsed = JSON.parse(jsonMatch[1] || content);

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
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    log.warn(`VLM quality check failed for ${photo.filename}`, {
      dropNumber: drNumber,
      error: isTimeout ? 'timeout' : (err as Error).message,
    }, MODULE);
    return { filename: photo.filename, step, passes: true, failReason: null, checkFailed: true };
  }
}

// ============================================================================
// BATCH VALIDATION
// ============================================================================

/**
 * Validate categorized photos against per-step visual quality criteria.
 *
 * Uses visual few-shot prompting where reference photos are available:
 * the VLM sees correct/incorrect examples alongside the new photo.
 * Falls back to text-only criteria for steps without reference photos (e.g. Step 7, 10).
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
