/**
 * Civil step quality criteria + VLM prompt builder for SiteCam.
 *
 * Mirrors the shape of activate/services/stepQualityCriteria.ts but scoped
 * to the 8-step civil (pole installation) job type. Steps 1–7 align with
 * the construction-qa CIVIL_CHECKLIST; step 8 is the Pole Label capture
 * added by migration 388 (civil 7/7 → 8/8). NB: Signature is an activation
 * step, not a civil step.
 */

import type { GalleryExamples, VlmContentPart } from '@/modules/activate/services/stepQualityCriteria';

export type CivilStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const CIVIL_QUALITY_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface CivilStepCriteria {
  label: string;
  requirements: string;
  failInstruction: string;
  failReason: string;
}

export const CIVIL_STEP_CRITERIA: Record<CivilStep, CivilStepCriteria> = {
  1: {
    label: 'Before Photo',
    requirements:
      'Ground/area before any digging. Intact ground OR chalk/spray-paint markings. No hole, no pole, no digging activity.',
    failInstruction:
      'FAIL if a hole is visible, pole is present, or active digging is shown.',
    failReason: 'Hole or pole visible — this must be a before-digging photo',
  },
  2: {
    label: 'During Photo',
    requirements:
      'Open hole with active excavation. Freshly dug earth piled beside the hole, spade/pick or worker may be visible. Hole EMPTY — no pole yet.',
    failInstruction:
      'FAIL if the hole is filled, a pole is standing in it, or no open hole is visible.',
    failReason: 'No open hole visible — must show active excavation',
  },
  3: {
    label: 'Depth Photo',
    requirements:
      'A measuring tape, ruler, or marked stick placed INSIDE the hole showing the depth measurement. Measuring instrument is the key visual element.',
    failInstruction:
      'FAIL if no measuring instrument is visible inside the hole, or if the reading is not visible.',
    failReason: 'No measuring instrument visible in the hole',
  },
  4: {
    label: 'End Plates',
    requirements:
      'Metal end-plates, HDPE strapping, cap plates, or metal brackets bolted or attached to the pole itself. Metal hardware or fittings ON the pole.',
    failInstruction:
      'FAIL if no metal hardware is visible on the pole, or if the photo is a ground-only shot with no pole hardware.',
    failReason: 'No end-plate hardware visible on pole',
  },
  5: {
    label: 'Compaction / Backfill',
    requirements:
      'Standing pole with hole fully filled and compacted with sand-cement mix around the base. Surface packed/tamped — not open, not a loose heap.',
    failInstruction:
      'FAIL if the hole is still open, no pole is standing, or the ground around the base is loose/uncompacted.',
    failReason: 'Hole not filled — must show compacted base around standing pole',
  },
  6: {
    label: 'Level Check',
    requirements:
      'A spirit level (bubble level tool) held against the side of an upright pole. The yellow or green bubble tool must be the key visual element.',
    failInstruction:
      'FAIL if no spirit level tool is visible in the photo.',
    failReason: 'No spirit level visible against the pole',
  },
  7: {
    label: 'After Photo',
    requirements:
      'Wide shot taken from a distance showing the full pole standing upright — entire pole from base to top visible, usually with sky/background.',
    failInstruction:
      'FAIL if the photo is a close-up only, or if the pole top or base is cut out of frame.',
    failReason: 'Pole not fully visible — must be a wide shot showing the complete pole',
  },
  8: {
    label: 'Pole Label',
    requirements:
      'A pole identification label, tag, or plate attached to the installed pole with the pole ID clearly legible. The label/tag on the pole is the key visual element.',
    failInstruction:
      'FAIL if no pole label/tag is visible on the pole, or if the pole ID is not legible.',
    failReason: 'No readable pole label visible on the pole',
  },
};

/**
 * Shared fail_reason instruction. Free-text (mirrors the activation builder's
 * FAIL_REASON_INSTRUCTION) so the technician gets the real, specific reason a
 * photo failed instead of the canned per-step sentence — the canned
 * CIVIL_STEP_CRITERIA[step].failReason is kept only as the fallback the
 * validate endpoint applies when the VLM returns no reason.
 */
export const CIVIL_FAIL_REASON_INSTRUCTION = `If it fails, fail_reason must be ONE short sentence (max 140 characters) written for the field technician: state what is wrong AND what to do to pass — for example "The hole is already filled — retake during active digging with the hole still open."`;

/**
 * Cross-step "wrong subject" instruction (opt-in via buildCivilMessageContent's
 * `crossStepClassification` flag — SiteCam live-capture only). Mirrors the
 * activation builder's buildCrossStepInstruction: listing every civil step's
 * subject lets the model recognise a misfiled photo and name what it actually
 * shows, instead of rationalising a misleading single-step reason. Folds in an
 * anti-hallucination guard (describe only what is visible).
 */
export function buildCivilCrossStepInstruction(step: CivilStep): string {
  const expected = CIVIL_STEP_CRITERIA[step].label;
  const taxonomy = (CIVIL_QUALITY_STEPS as readonly CivilStep[])
    .map((s) => `- ${CIVIL_STEP_CRITERIA[s].label}`)
    .join('\n');
  return `WRONG-SUBJECT CHECK (do this FIRST): a civil pole-installation photo shows one of these subjects:
${taxonomy}
This step expects "${expected}". Decide what the photo PRIMARILY shows. If it clearly shows one of the OTHER subjects above instead of "${expected}", FAIL and your fail_reason must name the subject it actually shows and that it belongs to a different step — e.g. "This is an After Photo, not a ${expected} — retake the ${expected} shot."

ONLY DESCRIBE WHAT YOU CAN SEE: do not invent a hole, measuring tape, end-plate, spirit level, label or pole that is not clearly visible. If the required subject is simply absent, say what the photo actually shows rather than guessing why a feature is "unclear".`;
}

/**
 * Build the VLM message content for a civil step quality check.
 *
 * @param step - The civil step number (1–8)
 * @param newPhotoBase64 - Base64-encoded JPEG of the photo to evaluate
 * @param galleryExamples - Optional gallery-curated positive/negative examples
 * @param opts.crossStepClassification - When true, prepend the wrong-subject /
 *   anti-hallucination instruction so a misfiled photo fails with a reason that
 *   names what it actually shows. Opt-in (SiteCam live-capture).
 */
export function buildCivilMessageContent(
  step: CivilStep,
  newPhotoBase64: string,
  galleryExamples?: GalleryExamples,
  opts?: { crossStepClassification?: boolean }
): { content: VlmContentPart[] } {
  const criteria = CIVIL_STEP_CRITERIA[step];
  const crossStep = opts?.crossStepClassification
    ? `${buildCivilCrossStepInstruction(step)}\n\n`
    : '';
  const content: VlmContentPart[] = [];

  const hasGallery =
    (galleryExamples?.positiveBase64.length ?? 0) > 0 ||
    (galleryExamples?.negativeBase64.length ?? 0) > 0;

  if (hasGallery && galleryExamples) {
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a civil pole installation.

${crossStep}I will first show you REFERENCE EXAMPLES from our QA team, then ask you to evaluate a NEW photo.`,
    });

    if (galleryExamples.positiveBase64.length > 0) {
      content.push({
        type: 'text',
        text: `GALLERY GOOD EXAMPLE${galleryExamples.positiveBase64.length > 1 ? 'S' : ''} — Approved by QA as passing "${criteria.label}" photos:`,
      });
      for (const b64 of galleryExamples.positiveBase64) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        });
      }
    }

    if (galleryExamples.negativeBase64.length > 0) {
      content.push({
        type: 'text',
        text: `GALLERY REJECT EXAMPLE${galleryExamples.negativeBase64.length > 1 ? 'S' : ''} — Rejected by QA as failing "${criteria.label}" photos:`,
      });
      for (const b64 of galleryExamples.negativeBase64) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
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

${CIVIL_FAIL_REASON_INSTRUCTION}

Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "<one short sentence as instructed above>"}`,
    });
  } else {
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a civil pole installation.

${crossStep}Required: ${criteria.requirements}
${criteria.failInstruction}

Evaluate this photo:`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${newPhotoBase64}` },
    });
    content.push({
      type: 'text',
      text: `${CIVIL_FAIL_REASON_INSTRUCTION}

Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "<one short sentence as instructed above>"}`,
    });
  }

  return { content };
}
