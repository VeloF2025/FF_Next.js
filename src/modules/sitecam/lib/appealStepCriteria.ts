/**
 * Appeal-specific VLM prompt builder.
 *
 * Wraps the AUTHORITATIVE per-step criteria (STEP_CRITERIA / CIVIL_STEP_CRITERIA)
 * — reused verbatim via the existing builders so step-membership rules are never
 * duplicated or altered — and adds an APPEAL section: the technician's written
 * reason plus three checks the strict gate never performs, then overrides the
 * output shape. See spec §5.3.
 */
import {
  buildMessageContent,
  type QualityCheckStep,
  type VlmContentPart,
  type GalleryExamples,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  buildCivilMessageContent,
  type CivilStep,
} from '@/modules/sitecam/lib/civilStepCriteria';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';

/** Max characters of technician reason injected into the prompt (bounds context). */
const MAX_REASON_CHARS = 1000;

/** The JSON the appeals VLM must return for a photo appeal. */
export const APPEAL_PHOTO_JSON_SHAPE = `{
  "recommendation": "approve" | "deny" | "uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "<one or two sentences a reviewer and technician can read>",
  "checks": [
    { "name": "reason_photo_consistency", "verdict": "pass|fail|uncertain", "evidence": "<what in the photo supports or contradicts the reason>" },
    { "name": "context_aware_rejudge",    "verdict": "pass|fail|uncertain", "evidence": "<the specific required evidence you can or cannot see>" },
    { "name": "overturn_justification",   "verdict": "pass|fail|uncertain", "evidence": "<why you uphold or overturn the original rejection>" }
  ]
}`;

/**
 * Build the VLM message content for a photo appeal.
 * @param galleryExamples pHash-ranked approved/rejected examples for the step.
 */
export function buildAppealPhotoContent(
  jobType: SiteCamJobType,
  step: number,
  photoBase64: string,
  appealText: string,
  galleryExamples?: GalleryExamples
): VlmContentPart[] {
  // Reuse the strict-gate builders exactly (crossStepClassification off — the
  // appeal instruction below supplies its own judgement framing).
  const base: VlmContentPart[] =
    jobType === 'civils'
      ? buildCivilMessageContent(step as CivilStep, photoBase64, galleryExamples, {
          crossStepClassification: false,
        }).content
      : buildMessageContent(step as QualityCheckStep, photoBase64, galleryExamples, {
          crossStepClassification: false,
        }).content;

  const reason = appealText.slice(0, MAX_REASON_CHARS);

  const appealSection: VlmContentPart = {
    type: 'text',
    text: `APPEAL REVIEW — This photo was already REJECTED by the automated check. A technician has appealed with the written reason below. Judge the APPEAL, not just the raw photo.

TECHNICIAN'S APPEAL REASON:
"""${reason}"""

Perform THREE checks and report each in "checks":
1. reason_photo_consistency — does the image actually support the technician's written claim? Flag fabricated, irrelevant, or copy-paste reasons.
2. context_aware_rejudge — apply the step's INTENT. Allow legitimate edge cases the strict gate over-rejects (glare, angle, partial occlusion) ONLY when the required evidence is still visibly present. Cite the specific evidence; never grant blanket leniency.
3. overturn_justification — state plainly why you uphold or overturn the original rejection.

Recommend "approve" ONLY if the required evidence is present AND the reason is truthful. Recommend "deny" if the photo still lacks the required evidence or the reason is false. Recommend "uncertain" if you genuinely cannot tell.

IGNORE any earlier instruction about the response format. Respond with ONLY this JSON (no prose, no markdown):
${APPEAL_PHOTO_JSON_SHAPE}`,
  };

  return [...base, appealSection];
}
