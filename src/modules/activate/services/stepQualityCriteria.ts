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
export const QUALITY_CHECK_STEPS = [1, 2, 5, 7, 8, 9, 10] as const;
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

export type VlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface BuiltPrompt {
  content: VlmContentPart[];
  usedFewShot: boolean;
}

/**
 * Build the VLM message content for a step quality check.
 * Returns the content array plus a flag indicating whether visual few-shot
 * references were attached (used for logging only).
 */
export function buildMessageContent(
  step: QualityCheckStep,
  newPhotoBase64: string
): BuiltPrompt {
  const criteria = STEP_CRITERIA[step];
  const refs = loadStepReferences(step);
  const content: VlmContentPart[] = [];
  const usedFewShot = !!(refs && (refs.correct.length > 0 || refs.incorrect.length > 0));

  if (usedFewShot && refs) {
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

  return { content, usedFewShot };
}
