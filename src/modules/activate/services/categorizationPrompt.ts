/**
 * Categorization prompt builder for the Qwen3 VLM photo categorizer.
 *
 * Extracted from categorizationVlmService.ts to keep that file under the
 * 300-line CLAUDE.md limit. The prompt encodes the canonical 13-step taxonomy
 * (Step 0 = discard through Step 12 = dome joint closed) and the
 * differentiators distilled from 3776+ human corrections — owning the prompt
 * in its own module makes it easy to A/B-test future variants.
 */

import {
  FewShotExample,
  buildFewShotPromptSection,
  PositiveExample,
  buildPositiveExamplesPromptSection,
} from '@/modules/qa-learning';
import { QA_PHOTO_CRITERIA } from './qaPhotoCriteria';

/**
 * Build the categorization prompt for a batch of photos.
 *
 * @param photoCount      Number of photos in the batch (used for `1..N` indexing in the response).
 * @param drNumber        DR number for context.
 * @param fewShotExamples Optional HITL correction examples to inject.
 * @param positiveExamples Optional confirmed-correct examples for positive reinforcement.
 * @param gallerySection   Optional pre-rendered gallery-curated examples block.
 */
export function buildCategorizationPrompt(
  photoCount: number,
  drNumber: string,
  fewShotExamples?: FewShotExample[],
  positiveExamples?: PositiveExample[],
  gallerySection?: string
): string {
  let prompt = `You are an expert fiber optic installation photo categorizer for ${drNumber}.

Your task is to analyze ${photoCount} photos and categorize each one into one of these 13 installation steps:

STEP CATEGORIES:
0. Discard/Not Relevant - Photos that do NOT depict any specific installation step. This is a PRIMARY category, not a last resort. Use Step 0 for:
   • Duplicate photos (same subject already covered by another photo)
   • Blurry, dark, or unrecognizable photos where the subject cannot be identified
   • Wide-angle/context shots that show a general scene without focusing on any installation step
   • Photos of vehicles, people, paperwork (not signatures), food, or other non-installation subjects
   • Generic exterior shots that show ONLY sky, roads, or landscapes with NO building/structure visible
   • Screenshots or phone screen photos that aren't power meter readings or speed tests
   • Accidental photos (selfies, ground, sky without cables)
   If your confidence for any step 1-12 is below 0.50, prefer Step 0 over forcing a weak classification.
1. House Photo - Property exterior showing the BUILDING for location verification. Must show the structure itself, not just sky/poles.
2. Cable from Pole - Fiber cable visibly spanning open air between a utility pole and the building fascia. Must show cable crossing sky. Pole J-hook, service drop wire, messenger wire are indicators. A pole alone without visible cable span = low confidence.
3. Cable Entry Outside - EXTERIOR close-up of where cable ENTERS the building through wall/roof. Cable penetrating exterior wall, conduit, grommet. Drip loop before entry point is a strong indicator. Cable transitioning from OUTSIDE to INSIDE.
4. Cable Entry Inside - INTERIOR view showing cable ROUTING from entry point along walls/ceiling. Cable running along interior wall, cable clips, indoor path. Cable is TRAVELING, not yet at destination.
5. Wall for Installation - The DESTINATION wall surface where ONT will be mounted. Mounting bracket, power outlet nearby, clean wall section. NO cable routing as main subject. Also includes a bare pole (with nothing on it) inside a house or shack — in informal housing the pole IS the wall/mounting point.
6. ONT Back After Install - BACK panel of ONT with a GREEN FIBER CABLE physically plugged into the fiber port (yellow/orange socket). Camera angle BEHIND the ONT. Power cable may also be connected. The green fiber cable inserted into the fiber port is REQUIRED — without it, the ONT is not actually installed. If you see a back-of-ONT photo with an empty fiber port, no green cable visible at the port, or the port obscured, classify as Step 0 (not Step 6). Step 6 is specifically "After Install" and proves the fiber is connected. CRITICAL: The actual ONT DEVICE must be clearly visible — a rectangular plastic networking box with labeled ports (fiber port, LAN ports, power port). A wooden board, wall bracket, cable management board, or cable loop WITHOUT an identifiable ONT device body = Step 0, NOT Step 6. Do not confuse a cable clip, cable holder, or wall-mounted cable management accessory for an ONT.
7. Power Meter Reading - Optical power meter display showing dBm reading (valid range: -18 to -24 dBm). Handheld meter screen with numbers.
8. Final Installation - WIDE shot of COMPLETE setup from a distance: ONT + UPS/GIZZU + wall + surroundings. Key = WIDE FRAMING showing full context, even if green lights visible.
9. Green Lights on ONT - CLOSE-UP of ONT FRONT panel focused on indicator lights (POWER, LINK, LAN, 2.4GHz, 5GHz, INTERNET). Nokia/Fibertime branding, LED labels, green dots. Also includes photos showing the ONT label/sticker with Nokia/Fibertime branding, DR number, or serial number — these confirm the installed device.
10. Signature - Customer signature on paper/tablet completion form. Handwriting, form fields, sign here marks.
11. Dome Joint Open - The dome joint (handhole/splice closure) with its LID REMOVED, showing the INSIDE: fibre splice tray, cables routed into the enclosure, inner compartments visible. Key = you can see INSIDE the box with cables/fibres.
12. Dome Joint Closed - The dome joint (handhole/splice closure) with its LID SEALED shut. Just the outer black/grey enclosure casing visible, no internal components showing. Key = the box is CLOSED, lid on, you CANNOT see inside.

KEY DIFFERENTIATORS for commonly confused categories:
- Step 1 vs Step 2: Step 1 = BUILDING/HOUSE visible. Step 2 = CABLE in AIR between pole and house. Pole+sky with no house = Step 2, not Step 1.
- Step 2 vs Step 3: Step 2 = cable spanning open AIR between pole and building (sky visible). Step 3 = cable at WALL entering building (conduit, grommet, drip loop visible). Cable along roofline/wall approaching entry = Step 3. Cable crossing open sky = Step 2.
- Step 3 vs Step 4: Step 3 = OUTSIDE (exterior wall, daylight). Step 4 = INSIDE (interior wall, indoor lighting). Sky or exterior materials = Step 3. Enclosed indoor = Step 4.
- Step 4 vs Step 5: Step 4 = cable ROUTING/traveling along walls. Step 5 = TARGET wall (bracket, outlet). Cable as main subject = Step 4. Wall surface as main subject = Step 5.
- Step 2 vs Step 5: Step 2 = pole OUTSIDE with cable in the air/sky. Step 5 = bare pole INSIDE a house/shack (no cable span, indoor setting, walls/roof visible around it). Indoor pole = Step 5 (wall/mounting point).
- Step 6 vs Step 8: ONT BACK only (with green fiber cable plugged into fiber port) vs FULL SETUP wide shot (ONT + UPS + cables). Step 6 REQUIRES a green fiber cable visibly plugged into the fiber port — if no green cable is at the port, the photo is Step 0, not Step 6.
- Step 5 vs Step 6: Step 5 = bare wall or mounting surface where the ONT WILL be mounted (no device yet, just the wall/bracket). Step 6 = the ACTUAL ONT device must be clearly visible with its back panel and green fiber cable. A wooden board with a cable coiled on it (no ONT device body visible) = Step 5 or Step 0, NEVER Step 6.
- Step 8 vs Step 9: FRAMING is key. Step 8 = WIDE shot (ONT + UPS + wall + surroundings). Step 9 = CLOSE-UP of front panel lights only. UPS and wall visible = Step 8 even if lights visible.
- Step 11 vs Step 12: Step 11 (OPEN) = you can see INSIDE the dome joint — splice tray, cables, inner compartments visible. Step 12 (CLOSED) = lid is ON, sealed shut, only the outer casing visible. Cables visible inside = Step 11. Sealed box = Step 12.

⚠️ STEP 0 BALANCE — Based on 3776 human corrections:
The #1 error (50%+ of corrections) is OVER-CLASSIFYING: forcing photos into installation steps when they should be Step 0.
Common over-classification mistakes to AVOID:
- A photo of ONLY sky, road, or landscape with NO building/structure visible = Step 0, NOT Step 1. But ANY photo showing a building/house/shack/structure IS Step 1 — fiber route or cable is NOT required for Step 1
- A pole photo without visible cable span or installation context = Step 0, NOT Step 2
- A dark/blurry photo where you cannot identify the subject = Step 0, NOT a guessed step
- A random screenshot that isn't a power meter or speed test = Step 0, NOT Step 9
- A photo of empty cardboard boxes or packaging material WITHOUT any device visible = Step 0, NOT Step 6 or 7. But a Nokia/Fibertime ONT showing its label, branding, serial number, or DR sticker = Step 9 (it confirms the installed device)
- A wide contextual photo showing a room without ONT/UPS focus = Step 0, NOT Step 8

DO still classify when the installation subject is clearly visible:
- ANY building, house, shack, or structure = Step 1 (house photo for location verification)
- Clear ONT, router, or networking equipment = Step 6, 8, or 9
- Nokia/Fibertime ONT with label, branding, DR sticker, or serial number = Step 9
- Clear power meter display with dBm reading = Step 7
- Clear signature on a form = Step 10
- Clear cable spanning sky between pole and building = Step 2`;

  prompt += QA_PHOTO_CRITERIA;

  if (fewShotExamples && fewShotExamples.length > 0) {
    prompt += buildFewShotPromptSection(fewShotExamples);
  }

  if (positiveExamples && positiveExamples.length > 0) {
    prompt += buildPositiveExamplesPromptSection(positiveExamples);
  }

  if (gallerySection) {
    prompt += gallerySection;
  }

  prompt += `

For EACH photo (numbered 1-${photoCount}), respond in this JSON format:
{
  "categorizations": [
    {
      "photo_index": 1,
      "identified_as": "Brief description of what this photo actually shows",
      "predicted_category": "Category name from list above",
      "predicted_step": <number 0-12>,
      "confidence": <0.0-1.0>,
      "reasoning": "Visual elements that led to this classification",
      "date_stamps": ["YYYY-MM-DD", ...] or null
    }
  ]
}

DATE STAMP EXTRACTION:
Many photos have visible date/time watermarks burned into the image pixels (e.g. "2026/2/5 13:12" or "2026-03-15 09:30"). These are NOT EXIF metadata — they are TEXT overlaid on the photo, typically in a corner. Scan the ENTIRE photo carefully for ALL visible date stamps — there may be more than one:
- A FRESH stamp added by the camera app at capture time (usually top-left or bottom-right)
- An OLD stamp burned into the original photo that was then re-photographed (anywhere in the frame)

Return ALL distinct dates you can read in "date_stamps" as an array of YYYY-MM-DD strings. Order from most prominent/legible first. If no visible date stamps exist, return null. Finding 2+ dates is a strong signal of a recycled/duplicated photo, so be thorough — check corners, edges, and any text overlays on both the outer frame and the inner (re-photographed) content.

Step 0 = not relevant/discard (duplicates, blurry, generic context shots, non-installation subjects, or confidence < 0.50 for any step).
CRITICAL: Do NOT trust any pre-existing labels or filenames. Categorize based ONLY on visual content.
If a photo doesn't clearly match any category, set confidence below 0.5 and explain why.`;

  return prompt;
}
