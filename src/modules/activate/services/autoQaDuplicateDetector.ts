/**
 * Duplicate-photo detection for the auto-QA pipeline.
 *
 * Extracted from autoQaProcessor.ts to keep that file under the 300-line
 * CLAUDE.md limit. Owns the two within-DR dedup steps:
 *
 *   1. Same-step dedup — within a DR, only the first photo for steps 1-10
 *      is kept; extras are flagged as Duplicate Photo (step -1).
 *
 *   2. Date-mismatch dedup — any photo whose EXIF date OR VLM-extracted
 *      visible date stamp differs from the DR submission day by more than
 *      MAX_DIFF_DAYS is flagged as Duplicate Photo (re-photographed content).
 *
 * Both mutate the caller's `photoResults` array in place and append to
 * `discardedPhotos` so the calling processor can persist the discard log.
 */

import { createLogger } from '@/lib/logger';
import { STEP_LABELS } from '../utils/stepMapper';
import { extractExifDatesForPhotos } from './photoDateValidator';
import {
  VLM_DATE_VALIDATION_ACTIVE_FROM,
  toSastYmd,
  parseStrictVlmDate,
} from './autoQaDateValidation';
import type { VlmCategorizationResult } from '../types/unified.types';
import type { AutoQaPhotoResult } from './autoQaCommentGenerator';

const log = createLogger('AutoQA');

/** Number of days a photo date can be off from the DR submission day before it's flagged. */
const MAX_DIFF_DAYS = 2;

export interface DiscardedPhoto {
  filename: string;
  originalStep: number;
  reason: string;
}

/**
 * Flag duplicate photos within the same DR/step. Mutates `photoResults` in
 * place: each duplicate gets `step = -1`, `decision = 'FAIL'`, and a comment.
 *
 * Returns the number of photos that were discarded.
 */
export function flagWithinDrStepDuplicates(
  photoResults: AutoQaPhotoResult[],
  discardedPhotos: DiscardedPhoto[],
): number {
  const seenSteps = new Set<number>();
  let count = 0;

  for (const photo of photoResults) {
    const step = photo.step;
    if (step < 1 || step > 10) continue;

    if (seenSteps.has(step)) {
      const originalLabel = STEP_LABELS[step] || `Step ${step}`;
      const reason = `Duplicate of ${originalLabel} — only one photo per step is kept`;
      discardedPhotos.push({ filename: photo.filename, originalStep: step, reason });
      photo.step = -1;
      photo.stepLabel = 'Duplicate Photo';
      photo.decision = 'FAIL';
      photo.comment = reason;
      count++;
    } else {
      seenSteps.add(step);
    }
  }

  return count;
}

interface PhotoMetadata {
  filename: string;
  url: string;
}

/**
 * Flag photos whose EXIF or VLM-extracted date stamps don't match the DR
 * submission day (within MAX_DIFF_DAYS tolerance). Mutates `photoResults`
 * in place and appends to `discardedPhotos`. Returns the count flagged.
 *
 * VLM date stamps are only consulted when the DR's VLM categorization run
 * is on or after VLM_DATE_VALIDATION_ACTIVE_FROM; older runs pre-date the
 * date_stamps extraction prompt.
 */
export async function flagDateMismatchDuplicates(
  dropNumber: string,
  photoResults: AutoQaPhotoResult[],
  categorizations: VlmCategorizationResult[],
  submittedDate: Date,
  vlmCategorizedAt: Date | null,
  photosMetadata: PhotoMetadata[],
  discardedPhotos: DiscardedPhoto[],
): Promise<number> {
  const exifDates = await extractExifDatesForPhotos(dropNumber, photosMetadata);

  const vlmDateValidationCutoff = new Date(
    `${VLM_DATE_VALIDATION_ACTIVE_FROM}T00:00:00+02:00`,
  );
  const vlmDateValidationActive =
    vlmCategorizedAt !== null && vlmCategorizedAt >= vlmDateValidationCutoff;

  if (!vlmDateValidationActive) {
    log.debug(
      `Skipping VLM date-stamp validation for ${dropNumber} — vlm_categorized_at (${vlmCategorizedAt?.toISOString() ?? 'null'}) is before cutoff ${VLM_DATE_VALIDATION_ACTIVE_FROM}`,
    );
  }

  const vlmAllDatesMap = vlmDateValidationActive
    ? buildVlmDateMap(dropNumber, categorizations)
    : new Map<string, Date[]>();

  if (vlmAllDatesMap.size > 0) {
    log.info(
      `VLM extracted visible date stamps for ${vlmAllDatesMap.size}/${categorizations.length} photos on ${dropNumber}`,
    );
  }

  const submittedYmd = toSastYmd(submittedDate);
  let flagged = 0;

  for (const photo of photoResults) {
    if (photo.step === -1) continue; // already discarded

    const candidateDates: Array<{ date: Date; source: string }> = [];
    const exifDate = exifDates.get(photo.filename);
    if (exifDate) candidateDates.push({ date: exifDate, source: 'EXIF' });

    if (vlmDateValidationActive) {
      const vlmDates = vlmAllDatesMap.get(photo.filename) ?? [];
      for (const d of vlmDates) {
        candidateDates.push({ date: d, source: 'visible date stamp' });
      }
    }

    if (candidateDates.length === 0) continue;

    const mismatched = candidateDates.filter(({ date }) => {
      const diffDays = Math.abs(date.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays > MAX_DIFF_DAYS;
    });

    if (mismatched.length === 0) continue;

    const datesList = candidateDates
      .map((c) => `${toSastYmd(c.date)} (${c.source})`)
      .join(', ');
    const reason =
      candidateDates.length >= 2
        ? `Duplicate photo — ${candidateDates.length} date stamps found (${datesList}) but DR submitted on ${submittedYmd}. Photo appears to be a re-photograph of older content.`
        : `Duplicate photo — ${candidateDates[0]!.source} shows ${toSastYmd(candidateDates[0]!.date)} but DR submitted on ${submittedYmd}. Photo date does not match DR submission day.`;

    discardedPhotos.push({ filename: photo.filename, originalStep: photo.step, reason });
    photo.step = -1;
    photo.stepLabel = 'Duplicate Photo';
    photo.decision = 'FAIL';
    photo.comment = reason;
    flagged++;
  }

  if (flagged > 0) {
    log.info(`Auto-discarded ${flagged} photo(s) as Duplicate Photo (date mismatch) on ${dropNumber}`);
  }
  return flagged;
}

function buildVlmDateMap(
  dropNumber: string,
  categorizations: VlmCategorizationResult[],
): Map<string, Date[]> {
  const map = new Map<string, Date[]>();

  for (const cat of categorizations) {
    const rawDates: string[] =
      Array.isArray(cat.vlm_date_stamps) && cat.vlm_date_stamps.length > 0
        ? cat.vlm_date_stamps
        : cat.vlm_date_stamp
          ? [cat.vlm_date_stamp]
          : [];

    const parsedDates: Date[] = [];
    for (const raw of rawDates) {
      const parsed = parseStrictVlmDate(raw, dropNumber);
      if (parsed !== null) parsedDates.push(parsed);
    }

    if (parsedDates.length > 0) {
      map.set(cat.photo_filename, parsedDates);
    } else if (rawDates.length > 0) {
      log.info(
        `VLM_DATE_EXTRACTION_REJECTED: all ${rawDates.length} raw date(s) for photo ${cat.photo_filename} on DR ${dropNumber} failed strict validation — treated as no date`,
      );
    }
  }

  return map;
}
