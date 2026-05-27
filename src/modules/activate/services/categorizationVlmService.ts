/**
 * VLM Photo Categorization Service
 *
 * Use Qwen3 VLM to categorize photos into installation steps without trusting
 * the pre-assigned OneMap types (field workers routinely upload photos to the
 * wrong attribute).
 *
 * This file orchestrates the batched VLM call and HITL example loading. The
 * prompt, HTTP client, and image fetching helpers each live in sibling
 * modules so this file stays under the CLAUDE.md 300-line limit:
 *  - ./categorizationPrompt         — buildCategorizationPrompt
 *  - ./categorizationImageFetcher   — fetchImageAsBase64, resolveImageUrl
 *  - ./categorizationVlmClient      — callVlmForCategorization
 *  - ./categorizationExampleLoader  — loadFewShotExamples, loadPositiveExamples,
 *                                     loadGalleryExamples
 */

import { log } from '@/lib/logger';
import {
  VlmCategorizationResult,
  STEP_LABELS,
} from '../types/unified.types';
import { VLM_BATCH_SIZE } from '@/lib/vlm';
import { fetchImageAsBase64 } from './categorizationImageFetcher';
import { callVlmForCategorization } from './categorizationVlmClient';
import {
  loadFewShotExamples,
  loadPositiveExamples,
  loadGalleryExamples,
} from './categorizationExampleLoader';

export { CategorizationError } from './categorizationError';

export interface PhotoInput {
  filename: string;
  url: string;
  original_type: string | null;
  original_step: number | null;
}

/**
 * Categorize photos using VLM.
 */
export async function categorizePhotos(
  drNumber: string,
  photos: PhotoInput[],
  batchSize: number = VLM_BATCH_SIZE,
): Promise<VlmCategorizationResult[]> {
  const startTime = Date.now();
  const results: VlmCategorizationResult[] = [];

  log.info(
    `Starting categorization for ${drNumber}: ${photos.length} photos`,
    undefined,
    'CategorizationVlm',
  );

  // HITL example sources are loaded once per DR (not per batch) and reused
  // across every batch's prompt. Each loader fails open (returns []/'').
  const fewShotExamples = await loadFewShotExamples(drNumber);
  const positiveExamples = await loadPositiveExamples(drNumber);
  const gallerySection = await loadGalleryExamples();

  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(photos.length / batchSize);

    log.info(
      `Processing batch ${batchNum}/${totalBatches} (${batch.length} photos)`,
      undefined,
      'CategorizationVlm',
    );

    const base64Images: string[] = [];
    const validPhotos: PhotoInput[] = [];

    for (const photo of batch) {
      try {
        const base64 = await fetchImageAsBase64(photo.url);
        base64Images.push(base64);
        validPhotos.push(photo);
      } catch (error) {
        log.warn(`Skipping ${photo.filename}: ${error}`, undefined, 'CategorizationVlm');
        results.push(buildErrorResult(photo, 'Failed to fetch image', error));
      }
    }

    if (base64Images.length === 0) {
      log.warn(`Batch ${batchNum} has no valid images, skipping`, undefined, 'CategorizationVlm');
      continue;
    }

    try {
      const vlmResponse = await callVlmForCategorization(
        drNumber,
        validPhotos,
        base64Images,
        fewShotExamples,
        positiveExamples,
        gallerySection,
      );

      for (const cat of vlmResponse.categorizations) {
        const photoIndex = cat.photo_index - 1; // VLM uses 1-based index
        const photo = validPhotos[photoIndex];

        if (!photo) {
          log.warn(
            `Invalid photo_index ${cat.photo_index} in VLM response`,
            undefined,
            'CategorizationVlm',
          );
          continue;
        }

        // Normalise date stamps: accept either new `date_stamps` array or legacy singular `date_stamp`
        const dateStamps: string[] = Array.isArray(cat.date_stamps)
          ? cat.date_stamps.filter(
              (d): d is string => typeof d === 'string' && d.length > 0,
            )
          : cat.date_stamp
            ? [cat.date_stamp]
            : [];
        const uniqueDates = Array.from(new Set(dateStamps));

        // Distinct telemetry so silent failures don't get masked as "no stamps".
        const photoMeta = { drNumber, photoFilename: photo.filename };
        if (!('date_stamps' in cat) && !('date_stamp' in cat)) {
          log.info('VLM_DATE_EXTRACTION_MISSING_FIELD', photoMeta, 'CategorizationVlm');
        } else if (uniqueDates.length === 0) {
          log.info('VLM_DATE_EXTRACTION_EMPTY', photoMeta, 'CategorizationVlm');
        } else {
          log.info(
            'VLM_DATE_EXTRACTION_OK',
            { ...photoMeta, count: uniqueDates.length, dates: uniqueDates },
            'CategorizationVlm',
          );
        }

        results.push({
          photo_filename: photo.filename,
          original_type: photo.original_type,
          original_step: photo.original_step,
          vlm_predicted_category: cat.predicted_category,
          vlm_predicted_step: cat.predicted_step,
          vlm_confidence: cat.confidence,
          vlm_identified_as: cat.identified_as,
          vlm_reasoning: cat.reasoning,
          vlm_date_stamp: uniqueDates[0] ?? null,
          vlm_date_stamps: uniqueDates.length > 0 ? uniqueDates : null,
          human_approved: null,
          human_override_step: null,
          human_override_reason: null,
        });
      }
    } catch (error) {
      log.error(`Batch ${batchNum} VLM error: ${error}`, undefined, 'CategorizationVlm');
      for (const photo of validPhotos) {
        results.push(buildErrorResult(photo, 'VLM categorization failed', error));
      }
    }
  }

  const duration = Date.now() - startTime;
  log.info(
    `Categorization complete for ${drNumber}: ${results.length} photos in ${duration}ms`,
    undefined,
    'CategorizationVlm',
  );

  return results;
}

function buildErrorResult(
  photo: PhotoInput,
  identifiedAs: string,
  error: unknown,
): VlmCategorizationResult {
  return {
    photo_filename: photo.filename,
    original_type: photo.original_type,
    original_step: photo.original_step,
    vlm_predicted_category: 'Error',
    vlm_predicted_step: 0,
    vlm_confidence: 0,
    vlm_identified_as: identifiedAs,
    vlm_reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
    human_approved: null,
    human_override_step: null,
    human_override_reason: null,
  };
}

export function getStepLabel(step: number): string {
  return STEP_LABELS[step] || `Unknown Step ${step}`;
}

export function doesCategorizationMatch(result: VlmCategorizationResult): boolean {
  if (result.original_step === null) return false;
  return result.vlm_predicted_step === result.original_step;
}

export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}
