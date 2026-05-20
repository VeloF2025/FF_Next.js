/**
 * Visual quality checks applied to passing photos before final QA decision.
 *
 * Extracted from autoQaProcessor.ts to keep that file under the 300-line
 * CLAUDE.md limit. Two independent checks live here:
 *
 *  1. ONT-back green-cable — Step 6 photos must show a green fiber cable
 *     plugged into the fiber port; otherwise reclassify to Step 0.
 *  2. Step quality — for steps in QUALITY_CHECK_STEPS (excl. step 6) that
 *     are currently PASS, run a per-step visual VLM check; fail-open on
 *     network/VLM errors to preserve the original verdict.
 *
 * Both mutate `photoResults` in place and append to `discardedPhotos`.
 */

import { createLogger } from '@/lib/logger';
import { validateOntBackCables } from './ontBackCableValidator';
import { validateStepQuality, QUALITY_CHECK_STEPS } from './stepQualityValidationService';
import type { AutoQaPhotoResult } from './autoQaCommentGenerator';
import type { DiscardedPhoto } from './autoQaDuplicateDetector';

const log = createLogger('AutoQA');

/**
 * Reclassify Step 6 photos that lack a green fiber cable at the port to
 * Step 0. Returns the number of photos reclassified.
 */
export async function applyOntBackCableCheck(
  dropNumber: string,
  photoResults: AutoQaPhotoResult[],
  urlByFilename: Map<string, string>,
  discardedPhotos: DiscardedPhoto[],
): Promise<number> {
  const step6PhotosForCheck = photoResults
    .filter((p) => p.step === 6 && urlByFilename.has(p.filename))
    .map((p) => ({ filename: p.filename, url: urlByFilename.get(p.filename)! }));

  if (step6PhotosForCheck.length === 0) return 0;

  const cableResults = await validateOntBackCables(dropNumber, step6PhotosForCheck);
  let noCableCount = 0;

  for (const photo of photoResults) {
    if (photo.step !== 6) continue;
    const result = cableResults.get(photo.filename);
    if (!result || result.checkFailed) continue;
    if (!result.hasGreenCable) {
      const reason = 'No green cable in the back';
      discardedPhotos.push({ filename: photo.filename, originalStep: photo.step, reason });
      photo.step = 0;
      photo.stepLabel = 'Discard - Rubbish';
      photo.decision = 'FAIL';
      photo.comment = reason;
      noCableCount++;
    }
  }

  if (noCableCount > 0) {
    log.info(
      `Reclassified ${noCableCount} Step 6 photo(s) to Step 0 for missing green fiber cable on ${dropNumber}`,
    );
  }
  return noCableCount;
}

/**
 * Run a per-step visual quality check for every currently-PASS photo whose
 * step is in QUALITY_CHECK_STEPS (step 6 is excluded — covered by the cable
 * check above). On VLM/network failure for a photo, leave its verdict intact.
 *
 * Returns the number of photos that were demoted from PASS to FAIL.
 */
export async function applyStepQualityCheck(
  dropNumber: string,
  photoResults: AutoQaPhotoResult[],
  urlByFilename: Map<string, string>,
): Promise<number> {
  const qualityCheckStepsSet = new Set<number>(QUALITY_CHECK_STEPS);
  const photosForQualityCheck: Array<{ filename: string; url: string; step: number }> = [];

  for (const p of photoResults) {
    if (!qualityCheckStepsSet.has(p.step) || p.decision !== 'PASS') continue;
    const url = urlByFilename.get(p.filename);
    if (!url) continue;
    photosForQualityCheck.push({ filename: p.filename, url, step: p.step });
  }

  if (photosForQualityCheck.length === 0) return 0;

  const qualityResults = await validateStepQuality(dropNumber, photosForQualityCheck);
  let qualityFailCount = 0;

  for (const photo of photoResults) {
    if (!qualityCheckStepsSet.has(photo.step)) continue;
    const result = qualityResults.get(photo.filename);
    if (!result || result.checkFailed) continue; // preserve original on VLM/network error
    if (!result.passes && result.failReason) {
      photo.decision = 'FAIL';
      photo.comment = result.failReason;
      qualityFailCount++;
    }
  }

  if (qualityFailCount > 0) {
    log.info(`Step quality check failed ${qualityFailCount} photo(s) for ${dropNumber}`);
  }
  return qualityFailCount;
}
