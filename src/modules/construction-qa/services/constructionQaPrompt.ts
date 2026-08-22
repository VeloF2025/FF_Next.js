/**
 * Construction QA VLM prompt builder.
 *
 * Extracted verbatim from vlmConstructionService.ts so the prompt has a single
 * home that can be imported without pulling in that module's top-level
 * `neon(process.env.DATABASE_URL!)` side effect. The VLM benchmark pack
 * (scripts/vlm-bench/packs/civilQa.ts) imports this so bench prompts cannot
 * drift from what production sends.
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

CIVIL CHECKLIST STEPS (in order of the installation process):
  Step 1 - Before Photo: Ground-level photo BEFORE digging. Shows chalk/spray paint markings (circle, square, X) on INTACT undisturbed ground OR just flat ground where the pole will go. NO hole, NO pole, NO digging yet. Can be a simple photo of the ground/area.
  Step 2 - During Photo: Active excavation — an OPEN HOLE visible in the ground, workers digging, spade/pick visible, freshly dug earth piled beside hole. Ground has been BROKEN OPEN. NO pole installed yet. The hole is EMPTY (no pole in it).
  Step 3 - Depth Photo: Measuring tape, ruler, or marked stick placed INSIDE the hole showing depth measurement. The measuring instrument is the key visual element.
  Step 4 - End Plates: Close-up of metal end-plates, HDPE strapping, cap plates, or metal brackets bolted/attached to the pole. Shows hardware/fittings on the pole itself. Can show metal straps, bolts, or rectangular plates at pole base or top. THIS IS NOT ground — it's metal hardware ON the pole.
  Step 5 - Compaction / Backfill: Ground AROUND the base of a STANDING pole that has been filled and compacted with sand+cement mix. The pole is already installed and the hole is FILLED (not open). Surface is packed/tamped — NOT a loose heap.
  Step 6 - Level Check: A spirit level (bubble level tool) held AGAINST the side of an upright pole. The yellow/green bubble tool is the key visual indicator.
  Step 7 - After Photo: Wide shot taken from a DISTANCE showing the full pole standing upright. You can see the entire pole from base to top, usually with sky/background visible. Taken standing BACK from the pole.
  Step 0 - Unrelated: ONLY use this for optical/fibre equipment (splice trays, domes, ONTs, fibre cables) or photos completely unrelated to pole installation.

⚠️ CRITICAL RULE: DO NOT classify as "Unrelated" (Step 0) unless the photo shows:
  - Optical/fibre equipment (splice trays, domes, fibre cables, ONTs, patch panels)
  - Something completely unrelated to pole installation (vehicles, people posing, documents)
  If the photo shows ANYTHING related to a pole, ground, hole, or construction → it is NOT Unrelated.
  Based on 1212 human corrections, 38% of all VLM errors are valid civil photos wrongly classified as Unrelated.

⚠️ TOP CONFUSION PAIRS (from 1212 human corrections — avoid these mistakes):
  1. During (2) vs Compaction (5): 208 errors. KEY: Is the hole OPEN and EMPTY → Step 2. Is the hole FILLED with pole standing → Step 5.
  2. Unrelated (0) vs End Plates (4): 200 errors. Close-up of metal hardware on a pole = Step 4, NOT unrelated.
  3. Unrelated (0) vs Before Photo (1): 152 errors. Ground-level photo without a hole = Step 1, NOT unrelated.
  4. Compaction (5) vs End Plates (4): 66 errors. Metal fittings/straps = Step 4. Packed earth surface = Step 5.
  5. Unrelated (0) vs After Photo (7): 62 errors. Wide shot showing a standing pole = Step 7, NOT unrelated.
  6. During (2) vs After Photo (7): 47 errors. If a pole is STANDING in the photo → Step 7. Step 2 has NO pole.

⚠️ BEFORE vs DURING:
  Step 1 (Before): Ground is FLAT and UNBROKEN. Paint/chalk marks on intact soil. NO hole.
  Step 2 (During): Ground is BROKEN. A DUG HOLE, piled dirt, or active digging. NO pole yet.
  → Intact ground = Step 1. Broken ground with hole = Step 2.

⚠️ DURING vs COMPACTION (most confused pair — 208 errors):
  Step 2 (During): Hole is OPEN and EMPTY. No pole installed. Workers may be digging.
  Step 5 (Compaction): Pole is STANDING. Hole is FILLED and PACKED around the pole base.
  → No pole + open hole = Step 2. Pole standing + filled ground = Step 5.

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
