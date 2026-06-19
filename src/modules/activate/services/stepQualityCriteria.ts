/**
 * Step Quality Criteria + VLM prompt builder
 *
 * Extracted from stepQualityValidationService.ts to keep the service file
 * under the 300-line limit (CLAUDE.md hard rule 11).
 *
 * Step 6 is excluded — handled by validateOntBackCables.
 */

import { loadStepReferences } from './qaReferencePhotos';

/** Steps with explicit visual quality criteria that receive a VLM check. */
export const QUALITY_CHECK_STEPS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] as const;
export type QualityCheckStep = (typeof QUALITY_CHECK_STEPS)[number];

export interface StepCriteria {
  label: string;
  requirements: string;
  failInstruction: string;
  failReason: string;
}

export const STEP_CRITERIA: Record<QualityCheckStep, StepCriteria> = {
  1: {
    label: 'House / Property Photo',
    requirements:
      'The full property (or near-full property) must be visible: at minimum two sides/corners of the building in frame, OR the front face with roof and both edges visible. The roof must be visible and the structure identifiable as a complete building/home/shack/property.',
    failInstruction:
      'FAIL if only one wall or side is visible (shot too close or side-on), if the roof or edges are cut off, or if it is a close-up of only a wall/door/window. FAIL if the main subject is a utility pole or aerial cable span — that is a Cable from Pole photo (Step 2), not a house photo.',
    failReason: 'Full property not in view',
  },
  2: {
    label: 'Cable from Pole',
    requirements:
      'A utility pole must be clearly visible in the frame. The cable or fiber span crossing through the air is also expected.',
    failInstruction:
      'FAIL if no utility pole or electrical pole is visible anywhere in the frame, even if a cable span is present. FAIL if the photo shows mainly a property/building facade without a pole — that is a House Photo (Step 1), not a cable-from-pole photo.',
    failReason: 'The pole is not in view',
  },
  3: {
    label: 'Cable Entry Outside',
    requirements:
      'The fiber optic cable entry point must be visible on the OUTSIDE of the building. A pipe, conduit, or hole in the exterior wall where the cable enters is expected. The cable or conduit must be visible entering or exiting through the wall from the outside. An upward-angle shot taken from outside — looking up at the eave, soffit, fascia or roofline where the drop cable runs down the exterior wall or enters under the roof overhang — IS a valid outside view. Visible sky, gutters, the underside of a roof overhang, or outdoor surroundings confirm the photo was taken from OUTSIDE.',
    failInstruction:
      'FAIL if no cable entry point, conduit, or pipe is visible on the outside wall. FAIL if the photo shows the inside of the building (interior ceiling, indoor room, furniture) or is taken from inside looking out. Do NOT fail an outdoor upward shot of the eave / soffit / roofline as "inside" — the underside of a roof overhang with sky or outdoor surroundings visible is OUTSIDE, not a ceiling.',
    failReason: 'Cable entry point not visible from outside',
  },
  4: {
    label: 'Cable Entry Inside',
    requirements:
      'An INTERIOR view of the fiber drop cable where it enters and is routed inside the building. ACCEPTABLE either way: (a) the cable entering through a hole, conduit or pipe in the interior wall, OR (b) the cable running down/along an interior wall or ceiling from the entry point — including a thin cable routed in a wall corner, secured with clips, or trailing toward its destination. Visible interior surroundings (room walls, a ceiling corner, indoor finish) confirm the photo was taken from INSIDE.',
    failInstruction:
      'FAIL only if no drop cable is visible inside at all, or if the photo is clearly taken from OUTSIDE the building (exterior wall, sky, outdoor surroundings). Do NOT fail just because a distinct hole, conduit or pipe is not visible — an interior cable routed along the wall or ceiling from the entry point is a valid Cable Entry Inside photo.',
    failReason: 'No interior cable entry or routing visible',
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
      'A wide shot showing both the white Fibertime/Nokia router AND a power outlet (wall socket) visible somewhere in the frame. The router may be mounted on a wall, placed on a countertop, on top of a TV, or on any surface — placement does not matter. The power outlet does not need to be the main subject; it only needs to be visible somewhere in the frame, including partially visible at the edge or corner.',
    failInstruction:
      'FAIL only if the white router is completely absent from the frame, OR if no power outlet is visible anywhere in the frame at all. Do NOT fail because the router is not wall-mounted, or because the power outlet is small or in a corner. A partially visible outlet counts as visible.',
    failReason: 'Router or power outlet not visible in frame',
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
  11: {
    label: 'Dome Joint Open',
    requirements:
      'The dome joint lid must be REMOVED or OPEN. The WHITE interior of the dome joint box must be clearly visible. GREEN fiber splice connectors ("green flickers") must be visible inside the box. Internal components (splice tray, black cable management clips, splitter blocks, cable routing) should be visible.',
    failInstruction:
      'FAIL if the lid is closed and no interior is visible — that is a closed dome joint (Step 12), not open. The white interior AND green splice connectors must be visible for this photo to pass.',
    failReason: 'Dome joint interior not visible — lid appears closed',
  },
  12: {
    label: 'Dome Joint Closed',
    requirements:
      'The dome joint must be fully SEALED with its black rectangular lid closed on the circular housing. Only the black exterior/back of the dome joint box should be visible. The interior must NOT be visible — it must be completely sealed. Yellow cables entering the bottom of the unit are acceptable.',
    failInstruction:
      'FAIL if the interior of the dome joint is visible (white interior, green splice connectors) — that is an open dome joint (Step 11), not closed.',
    failReason: 'Dome joint is not sealed — interior visible',
  },
};

/**
 * Shared fail_reason instruction. Free-text so the technician gets real
 * direction instead of one canned per-step sentence (which masked issues
 * like re-photographed screens as framing complaints).
 */
export const FAIL_REASON_INSTRUCTION = `If it fails, fail_reason must be ONE short sentence (max 140 characters) written for the field technician: state what is wrong AND what to do to pass — for example "Only the top floor is in frame — step back so the roof and both building edges are visible."

SPECIAL CASE: if the image appears to be a photograph of a screen, monitor, or printed photo (moiré/interference patterns, screen bezels or borders, visible pixels, glare bands), fail_reason must say that — e.g. "This looks like a photo of a screen — take the photo of the real scene on site." — instead of a framing complaint.`;

/**
 * Cross-step "wrong subject" instruction (opt-in via buildMessageContent's
 * `crossStepClassification` flag — SiteCam live-capture only).
 *
 * The per-step prompt otherwise shows the model ONLY the criteria for the step
 * being checked, so when the wrong photo is submitted the model rationalises a
 * misleading reason against that step ("entry point not clearly visible") and
 * may invent details. Listing every step's subject lets the model recognise the
 * photo actually belongs to a different step and say so, instead of guessing.
 * Also folds in an anti-hallucination guard (describe only what is visible).
 */
export function buildCrossStepInstruction(step: QualityCheckStep): string {
  const expected = STEP_CRITERIA[step].label;
  const taxonomy = (QUALITY_CHECK_STEPS as readonly QualityCheckStep[])
    .map((s) => `- ${STEP_CRITERIA[s].label}`)
    .join('\n');
  return `WRONG-SUBJECT CHECK (do this FIRST): an installation photo shows one of these subjects:
${taxonomy}
This step expects "${expected}". Decide what the photo PRIMARILY shows. If it clearly shows one of the OTHER subjects above instead of "${expected}", FAIL and your fail_reason must name the subject it actually shows and that it belongs to a different step — e.g. "This is a Wall for Installation photo, not a ${expected} — retake the ${expected} shot."

ONLY DESCRIBE WHAT YOU CAN SEE: do not invent a cable, hole, conduit, pipe, bracket or device that is not clearly visible. If the required subject is simply absent, say what the photo actually shows rather than guessing why a feature is "unclear".`;
}

export type VlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface BuiltPrompt {
  content: VlmContentPart[];
  usedFewShot: boolean;
}

export interface GalleryExamples {
  positiveBase64: string[];
  negativeBase64: string[];
}

/**
 * Build the VLM message content for a step quality check.
 * Returns the content array plus a flag indicating whether visual few-shot
 * references were attached (used for logging only).
 *
 * @param galleryExamples - Optional gallery-curated examples fetched from
 *   vlm_visual_photo_examples. Injected after the static filesystem references.
 * @param opts.crossStepClassification - When true, prepend the wrong-subject /
 *   anti-hallucination instruction so a misfiled photo fails with a reason that
 *   names what it actually shows. Opt-in (SiteCam live-capture); auto-QA leaves
 *   it off to keep its prompt unchanged.
 */
export function buildMessageContent(
  step: QualityCheckStep,
  newPhotoBase64: string,
  galleryExamples?: GalleryExamples,
  opts?: { crossStepClassification?: boolean }
): BuiltPrompt {
  const criteria = STEP_CRITERIA[step];
  const refs = loadStepReferences(step);
  const crossStep = opts?.crossStepClassification
    ? `${buildCrossStepInstruction(step)}\n\n`
    : '';
  const content: VlmContentPart[] = [];
  const hasGallery =
    (galleryExamples?.positiveBase64.length ?? 0) > 0 ||
    (galleryExamples?.negativeBase64.length ?? 0) > 0;
  const usedFewShot = !!(refs && (refs.correct.length > 0 || refs.incorrect.length > 0)) || hasGallery;

  if (usedFewShot && (refs || hasGallery)) {
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a fiber optic installation.

${crossStep}I will show you APPROVED EXAMPLES from our QA team. Your pass/fail decision MUST be consistent with these examples — they are the authoritative standard.`,
    });

    if (refs && refs.correct.length > 0) {
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

    if (refs && refs.incorrect.length > 0) {
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

    if (galleryExamples && galleryExamples.positiveBase64.length > 0) {
      content.push({
        type: 'text',
        text: `PRIMARY APPROVED EXAMPLE${galleryExamples.positiveBase64.length > 1 ? 'S' : ''} — QA-confirmed PASSING "${criteria.label}" photos. Your decision MUST be consistent with these:`,
      });
      for (const b64 of galleryExamples.positiveBase64) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        });
      }
    }

    if (galleryExamples && galleryExamples.negativeBase64.length > 0) {
      content.push({
        type: 'text',
        text: `PRIMARY REJECT EXAMPLE${galleryExamples.negativeBase64.length > 1 ? 'S' : ''} — QA-confirmed FAILING "${criteria.label}" photos. If the new photo resembles these, it MUST fail:`,
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

${FAIL_REASON_INSTRUCTION}

Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "<one short sentence as instructed above>"}`,
    });
  } else {
    content.push({
      type: 'text',
      text: `You are performing a quality check on a photo classified as "${criteria.label}" for a fiber optic installation.

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
      text: `${FAIL_REASON_INSTRUCTION}

Return STRICT JSON only — no other text:
{"passes": true, "fail_reason": null}
OR
{"passes": false, "fail_reason": "<one short sentence as instructed above>"}`,
    });
  }

  return { content, usedFewShot };
}
