/**
 * Construction QA VLM prompt builder.
 *
 * Lifted out of vlmConstructionService.ts so the prompt has a single home that
 * can be imported without pulling in that module's top-level
 * `neon(process.env.DATABASE_URL!)` side effect. The VLM benchmark pack
 * (scripts/vlm-bench/packs/civilQa.ts) imports this so bench prompts cannot
 * drift from what production sends.
 *
 * The move was verbatim; the classification block has since been rewritten as
 * an ordered decision procedure (see git log for the measured before/after).
 * Do not assume this text matches the original production prompt.
 */

import type { Discipline } from '../types';

/**
 * Build discipline-specific VLM prompt for a checklist step.
 */
export function buildPhotoPrompt(
  discipline: Discipline,
  step: number | null,
  stepDef: { label: string; vlmCheck: string; notes?: string } | null,
  fewShotSection = '',
): string {
  // When step is null or 0, use multi-step classification mode
  const isClassification = !step || !stepDef;

  const classificationBlock = isClassification ? `
You must CLASSIFY which checklist step this photo belongs to.

Work through this ordered decision procedure and STOP at the first step that matches.
Each test is about what is VISIBLE in the frame, not about what the crew was doing.

  1. Is the flat CUT END of a pole the subject of the photo — a round/octagonal
     end face, usually with a stamped metal cap and a coloured (often red)
     centre plug, normally a close-up? → Step 4 (End Plates).
     The pole is usually LYING ON THE GROUND for this photo. Soil, gravel or
     rubble around it does NOT make it a ground photo.
  2. Is a spirit level (bubble level) held against a pole? → Step 6 (Level Check).
  3. Is a tape measure, ruler or marked stick inside a hole? → Step 3 (Depth).
  4. Is a pole STANDING UPRIGHT in the ground?
     a. Can you see the WHOLE pole, base AND top, with sky or open background
        above it (a wide shot taken from a distance)? → Step 7 (After).
     b. Otherwise the frame is cropped to the pole BASE and the ground around
        it → Step 5 (Compaction / Backfill).
  5. No pole is standing and none is the subject. Is the ground BROKEN OPEN —
     an open hole, a trench, piled excavated soil, someone digging? → Step 2 (During).
  6. Is the ground INTACT — flat, undisturbed, possibly with chalk or spray-paint
     marks where the pole will go? → Step 1 (Before).
  7. Optical/fibre equipment or something with nothing to do with pole
     installation → Step 0 (Unrelated).

CIVIL CHECKLIST STEPS:
  Step 1 - Before Photo: Intact undisturbed ground where the pole will go, often with chalk/spray markings. NO hole, NO pole.
  Step 2 - During Photo: Broken ground with NO POLE ANYWHERE IN THE FRAME — an open hole, trench, or excavation in progress.
  Step 3 - Depth Photo: Tape measure, ruler or marked stick inside the hole, showing depth.
  Step 4 - End Plates: Close-up of the pole's CUT END FACE and its end cap/plate — a round or octagonal stamped plate, usually with a coloured centre plug. The pole is typically lying horizontally on the ground.
  Step 5 - Compaction / Backfill: Close-up of the base of a STANDING pole and the ground around it, being filled or already filled. The material may be loose, wet, heaped or packed — all of these are Step 5. A worker tamping with a rod, or a base plate sitting on the soil, is Step 5.
  Step 6 - Level Check: A spirit level held against an upright pole.
  Step 7 - After Photo: Wide shot from a distance showing the ENTIRE standing pole, base to top, against sky or open background.
  Step 0 - Unrelated: ONLY optical/fibre equipment, or photos with nothing to do with pole installation.

⚠️ A PERSON OR A HAND TOOL IN THE FRAME DECIDES NOTHING.
  Workers appear at every stage. A worker beside a standing pole is Step 5 or 7,
  never Step 2. Step 2 requires that NO pole is present at all.

⚠️ CRITICAL RULE: DO NOT classify as "Unrelated" (Step 0) unless the photo shows:
  - Optical/fibre equipment (splice trays, domes, fibre cables, ONTs, patch panels)
  - Something completely unrelated to pole installation (vehicles, people posing, documents)
  If the photo shows ANYTHING related to a pole, ground, hole, or construction → it is NOT Unrelated.
  A close-up of a pole end cap is Step 4, not Unrelated.

⚠️ THE THREE MISTAKES THIS MODEL ACTUALLY MAKES (measured on 160 human-labelled photos):
  1. End Plates (4) called Compaction (5): the pole's cut end lying on soil is
     read as "ground at a pole base". If the END FACE of the pole is what you
     are looking at, it is Step 4 — no matter what is under the pole.
  2. Compaction (5) called During (2): backfill in progress is read as digging.
     If a pole is STANDING in the frame it can never be Step 2.
  3. After (7) called During (2) or Before (1): a distant pole is missed and the
     photo is judged on its foreground ground. Look for the pole first; if the
     whole pole is visible against the sky, it is Step 7.

⚠️ OPTICAL EQUIPMENT = UNRELATED (Step 0):
Only these are unrelated: splice trays, fibre closures, dome joints, dome interiors, ODF panels, patch panels, fibre labels, cable termination boxes, ONTs, loose fibre strands.

Respond with this JSON:
{
  "classified_step": <1-7 or 0 if unrelated/optical>,
  "step_label": "<label from the list above>",
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of specific issues found"],
  "feedback": "one sentence of actionable feedback",
  "extracted_data": {}
}
` : '';

  const validationBlock = !isClassification ? `
Evaluate this photo and respond with ONLY a JSON object:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of specific issues found"],
  "feedback": "one sentence of actionable feedback for the field technician",
  "extracted_data": { any relevant data extracted from the photo }
}

Be strict but fair. A photo must clearly show the required element to pass.` : '';

  const base = `You are a construction quality assurance AI inspector for fiber network installations.
Discipline: ${discipline}
${!isClassification ? `Checklist Step ${step}: ${stepDef?.label || 'Unknown'}` : 'Photo Step Classification'}

${stepDef?.vlmCheck ? `Check: ${stepDef.vlmCheck}` : ''}
${stepDef?.notes ? `Notes: ${stepDef.notes}` : ''}
${fewShotSection ? `\n${fewShotSection}\n` : ''}${classificationBlock}${validationBlock}`;

  return base;
}
