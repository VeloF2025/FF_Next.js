/**
 * VLM Photo Categorization Service
 *
 * Purpose: Use Qwen3 VLM to categorize photos into installation steps
 * without trusting the pre-assigned OneMap types.
 *
 * Problem: Field workers upload photos to wrong attributes in OneMap.
 * Solution: VLM analyzes visual content and predicts correct category.
 *
 * Status: WORKING - Phase 1 implementation
 */

import { log } from '@/lib/logger';
import {
  VlmCategorizationResult,
  VlmBatchCategorizationResponse,
  STEP_LABELS,
} from '../types/unified.types';
import {
  FewShotExample,
  getRelevantExamples,
  buildFewShotPromptSection,
  hasCorrections,
} from '@/modules/qa-learning';

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_CATEGORIZATION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 180000; // 3 minutes per batch
const VLM_MAX_BATCH_SIZE = 6; // Max photos per VLM call (token limit)
const VLM_TEMPERATURE = 0.1; // Low for consistent categorization

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class CategorizationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CategorizationError';
  }
}

// ============================================================================
// PROMPTS
// ============================================================================

/**
 * Build the categorization prompt for a batch of photos
 *
 * @param photoCount - Number of photos in batch
 * @param drNumber - DR number for context
 * @param fewShotExamples - Optional few-shot examples from human corrections
 */
function buildCategorizationPrompt(
  photoCount: number,
  drNumber: string,
  fewShotExamples?: FewShotExample[]
): string {
  let prompt = `You are an expert fiber optic installation photo categorizer for ${drNumber}.

Your task is to analyze ${photoCount} photos and categorize each one into one of these 11 installation steps:

STEP CATEGORIES:
0. Unclassifiable/Discard - ONLY for: completely blank photos, accidental selfies, unrelated objects (food, pets, vehicles). NOT for blurry/dark installation photos.
1. House Photo - Property exterior showing the BUILDING for location verification. Must show the structure itself, not just sky/poles.
2. Cable from Pole - Fiber cable visibly spanning open air between a utility pole and the building fascia. Must show cable crossing sky. Pole J-hook, service drop wire, messenger wire are indicators. A pole alone without visible cable span = low confidence.
3. Cable Entry Outside - EXTERIOR close-up of where cable ENTERS the building through wall/roof. Cable penetrating exterior wall, conduit, grommet. Drip loop before entry point is a strong indicator. Cable transitioning from OUTSIDE to INSIDE.
4. Cable Entry Inside - INTERIOR view showing cable ROUTING from entry point along walls/ceiling. Cable running along interior wall, cable clips, indoor path. Cable is TRAVELING, not yet at destination.
5. Wall for Installation - The DESTINATION wall surface where ONT will be mounted. Mounting bracket, power outlet nearby, clean wall section. NO cable routing as main subject.
6. ONT Back After Install - BACK panel of ONT showing fiber port and power cable connections. Yellow fiber connector, power cable. Camera angle BEHIND the ONT.
7. Power Meter Reading - Optical power meter display showing dBm reading (valid range: -18 to -24 dBm). Handheld meter screen with numbers.
8. Final Installation - WIDE shot of COMPLETE setup from a distance: ONT + UPS/GIZZU + wall + surroundings. Key = WIDE FRAMING showing full context, even if green lights visible.
9. Green Lights on ONT - CLOSE-UP of ONT FRONT panel focused on indicator lights (POWER, LINK, LAN, 2.4GHz, 5GHz, INTERNET). Nokia/Fibertime branding, LED labels, green dots.
10. Signature - Customer signature on paper/tablet completion form. Handwriting, form fields, sign here marks.

KEY DIFFERENTIATORS for commonly confused categories:
- Step 1 vs Step 2: Step 1 = BUILDING/HOUSE visible. Step 2 = CABLE in AIR between pole and house. Pole+sky with no house = Step 2, not Step 1.
- Step 2 vs Step 3: Step 2 = cable spanning open AIR between pole and building (sky visible). Step 3 = cable at WALL entering building (conduit, grommet, drip loop visible). Cable along roofline/wall approaching entry = Step 3. Cable crossing open sky = Step 2.
- Step 3 vs Step 4: Step 3 = OUTSIDE (exterior wall, daylight). Step 4 = INSIDE (interior wall, indoor lighting). Sky or exterior materials = Step 3. Enclosed indoor = Step 4.
- Step 4 vs Step 5: Step 4 = cable ROUTING/traveling along walls. Step 5 = TARGET wall (bracket, outlet). Cable as main subject = Step 4. Wall surface as main subject = Step 5.
- Step 6 vs Step 8: ONT BACK only (cables) vs FULL SETUP wide shot (ONT + UPS + cables)
- Step 8 vs Step 9: FRAMING is key. Step 8 = WIDE shot (ONT + UPS + wall + surroundings). Step 9 = CLOSE-UP of front panel lights only. UPS and wall visible = Step 8 even if lights visible.

⚠️ CRITICAL — DO NOT DISCARD (Step 0) unless the photo is truly rubbish:
Based on 2336 human corrections, the #1 VLM error is wrongly discarding valid installation photos.
- A blurry or dark photo of installation equipment is NOT rubbish — classify it to the best matching step with low confidence.
- An outdoor photo showing poles, cables, or buildings = Step 1 or 2, NOT discard.
- A photo of an ONT, router, or networking equipment = Step 6, 8, or 9, NOT discard.
- A photo of a meter, display, or screen = Step 7, NOT discard.
- A photo of a signature or form = Step 10, NOT discard.
- ONLY discard: completely blank photos, accidental selfies, unrelated objects (food, pets, vehicles).`;

  // Inject few-shot examples from human corrections (HITL learning)
  if (fewShotExamples && fewShotExamples.length > 0) {
    prompt += buildFewShotPromptSection(fewShotExamples);
  }

  prompt += `

For EACH photo (numbered 1-${photoCount}), respond in this JSON format:
{
  "categorizations": [
    {
      "photo_index": 1,
      "identified_as": "Brief description of what this photo actually shows",
      "predicted_category": "Category name from list above",
      "predicted_step": <number 0-10>,
      "confidence": <0.0-1.0>,
      "reasoning": "Visual elements that led to this classification"
    }
  ]
}

Step 0 = unclassifiable (completely blank, selfies, unrelated objects ONLY).
CRITICAL: Do NOT trust any pre-existing labels or filenames. Categorize based ONLY on visual content.
If a photo doesn't clearly match any category, set confidence below 0.5 and explain why.`;

  return prompt;
}

// ============================================================================
// IMAGE HANDLING
// ============================================================================

// Internal OneMap server for direct photo fetching (bypasses proxy for server-side)
const ONEMAP_INTERNAL_URL = process.env.ONEMAP_INTERNAL_URL || 'http://100.96.203.105:8003';

/**
 * Convert proxy URL to internal OneMap URL for server-side fetching
 *
 * Proxy URL format: /api/activate/photo/{drNumber}/{filename}
 * Internal URL format: http://100.96.203.105:8003/api/photo/{drNumber}/{filename}
 */
function resolveImageUrl(imageUrl: string): string {
  // If already an absolute URL, use it directly
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // Convert relative proxy URL to internal OneMap URL
  // /api/activate/photo/DR123/file.jpg → http://100.96.203.105:8003/api/photo/DR123/file.jpg
  const proxyPattern = /^\/api\/activate\/photo\/(.+)$/;
  const match = imageUrl.match(proxyPattern);

  if (match) {
    const internalUrl = `${ONEMAP_INTERNAL_URL}/api/photo/${match[1]}`;
    log.debug(`Resolved proxy URL to internal: ${imageUrl} → ${internalUrl}`, undefined, 'CategorizationVlm');
    return internalUrl;
  }

  // Fallback: prepend internal URL base (shouldn't happen with current architecture)
  log.warn(`Unrecognized URL format, using as-is: ${imageUrl}`, undefined, 'CategorizationVlm');
  return imageUrl;
}

/**
 * Fetch an image and convert to base64
 *
 * Handles both:
 * - Relative proxy URLs: /api/activate/photo/{dr}/{file} → converts to internal OneMap
 * - Absolute URLs: Used directly
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const resolvedUrl = resolveImageUrl(imageUrl);

  try {
    const response = await fetch(resolvedUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} from ${resolvedUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    return base64;
  } catch (error) {
    log.error(`Failed to fetch/encode image ${resolvedUrl}: ${error}`, undefined, 'CategorizationVlm');
    throw error;
  }
}

// ============================================================================
// VLM API CALLS
// ============================================================================

/**
 * Call VLM API to categorize a batch of photos
 *
 * @param drNumber - DR number for context
 * @param photos - Array of photos to categorize
 * @param base64Images - Base64 encoded images
 * @param fewShotExamples - Optional few-shot examples for prompt enhancement
 */
async function callVlmForCategorization(
  drNumber: string,
  photos: Array<{ filename: string; url: string; original_type: string | null }>,
  base64Images: string[],
  fewShotExamples?: FewShotExample[]
): Promise<VlmBatchCategorizationResponse> {
  const prompt = buildCategorizationPrompt(photos.length, drNumber, fewShotExamples);

  const requestBody = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          ...base64Images.map((base64) => ({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64}`,
            },
          })),
        ],
      },
    ],
    max_tokens: 4000,
    temperature: VLM_TEMPERATURE,
  };

  log.info(`Calling ${VLM_MODEL} for ${drNumber} (${photos.length} photos)...`, undefined, 'CategorizationVlm');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new CategorizationError(
        `VLM API returned ${response.status}: ${errorText}`,
        `VLM_HTTP_${response.status}`,
        errorText
      );
    }

    const data = await response.json();
    log.info(`VLM response received for ${drNumber}`, undefined, 'CategorizationVlm');

    // Parse response
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new CategorizationError('No content in VLM response', 'VLM_EMPTY_RESPONSE');
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];

    const parsed = JSON.parse(jsonMatch[1] || content);

    if (!parsed.categorizations || !Array.isArray(parsed.categorizations)) {
      throw new CategorizationError(
        'Invalid VLM response format: missing categorizations array',
        'VLM_INVALID_FORMAT',
        parsed
      );
    }

    return parsed as VlmBatchCategorizationResponse;
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new CategorizationError('VLM API request timed out', 'VLM_TIMEOUT');
    }

    if (error instanceof CategorizationError) {
      throw error;
    }

    throw new CategorizationError(
      `VLM API error: ${error instanceof Error ? error.message : String(error)}`,
      'VLM_API_ERROR',
      error
    );
  }
}

// ============================================================================
// MAIN CATEGORIZATION FUNCTION
// ============================================================================

/**
 * Photo input for categorization
 */
export interface PhotoInput {
  filename: string;
  url: string;
  original_type: string | null;
  original_step: number | null;
}

/**
 * Categorize photos using VLM
 *
 * @param drNumber - DR number being processed
 * @param photos - Array of photos with URLs and original metadata
 * @param batchSize - Optional batch size override (default: 6)
 * @returns Array of categorization results
 */
export async function categorizePhotos(
  drNumber: string,
  photos: PhotoInput[],
  batchSize: number = VLM_MAX_BATCH_SIZE
): Promise<VlmCategorizationResult[]> {
  const startTime = Date.now();
  const results: VlmCategorizationResult[] = [];

  log.info(`Starting categorization for ${drNumber}: ${photos.length} photos`, undefined, 'CategorizationVlm');

  // HITL Learning: Fetch few-shot examples from human corrections
  let fewShotExamples: FewShotExample[] = [];
  try {
    // Quick check to avoid unnecessary queries
    const hasCorrectionData = await hasCorrections('dr_photo');
    if (hasCorrectionData) {
      const selectionResult = await getRelevantExamples({
        workflowType: 'dr_photo',
        maxExamples: 5,
        includeConfusionPairs: true,
      });
      fewShotExamples = selectionResult.examples;

      if (fewShotExamples.length > 0) {
        log.info('Few-shot examples loaded for categorization', {
          action: 'fewShotLoaded',
          drNumber,
          exampleCount: fewShotExamples.length,
          criteria: selectionResult.selectionCriteria,
        }, 'CategorizationVlm');
      }
    }
  } catch (error) {
    // Don't fail categorization if few-shot loading fails
    log.warn('Few-shot example loading failed', {
      action: 'fewShotLoadFailed',
      drNumber,
      error: error instanceof Error ? error.message : String(error),
    }, 'CategorizationVlm');
  }

  // Process in batches
  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(photos.length / batchSize);

    log.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} photos)`, undefined, 'CategorizationVlm');

    // Fetch and encode images
    const base64Images: string[] = [];
    const validPhotos: PhotoInput[] = [];

    for (const photo of batch) {
      try {
        const base64 = await fetchImageAsBase64(photo.url);
        base64Images.push(base64);
        validPhotos.push(photo);
      } catch (error) {
        log.warn(`Skipping ${photo.filename}: ${error}`, undefined, 'CategorizationVlm');
        // Add failed photo with error result
        results.push({
          photo_filename: photo.filename,
          original_type: photo.original_type,
          original_step: photo.original_step,
          vlm_predicted_category: 'Error',
          vlm_predicted_step: 0,
          vlm_confidence: 0,
          vlm_identified_as: 'Failed to fetch image',
          vlm_reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
          human_approved: null,
          human_override_step: null,
          human_override_reason: null,
        });
      }
    }

    if (base64Images.length === 0) {
      log.warn(`Batch ${batchNum} has no valid images, skipping`, undefined, 'CategorizationVlm');
      continue;
    }

    // Call VLM with few-shot examples
    try {
      const vlmResponse = await callVlmForCategorization(
        drNumber,
        validPhotos,
        base64Images,
        fewShotExamples
      );

      // Map VLM response to results
      for (const cat of vlmResponse.categorizations) {
        const photoIndex = cat.photo_index - 1; // VLM uses 1-based index
        const photo = validPhotos[photoIndex];

        if (!photo) {
          log.warn(`Invalid photo_index ${cat.photo_index} in VLM response`, undefined, 'CategorizationVlm');
          continue;
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
          human_approved: null,
          human_override_step: null,
          human_override_reason: null,
        });
      }
    } catch (error) {
      log.error(`Batch ${batchNum} VLM error: ${error}`, undefined, 'CategorizationVlm');

      // Mark all photos in batch as failed
      for (const photo of validPhotos) {
        results.push({
          photo_filename: photo.filename,
          original_type: photo.original_type,
          original_step: photo.original_step,
          vlm_predicted_category: 'Error',
          vlm_predicted_step: 0,
          vlm_confidence: 0,
          vlm_identified_as: 'VLM categorization failed',
          vlm_reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
          human_approved: null,
          human_override_step: null,
          human_override_reason: null,
        });
      }
    }
  }

  const duration = Date.now() - startTime;
  log.info(
    `Categorization complete for ${drNumber}: ${results.length} photos in ${duration}ms`,
    undefined,
    'CategorizationVlm'
  );

  return results;
}

/**
 * Get step label from step number
 */
export function getStepLabel(step: number): string {
  return STEP_LABELS[step] || `Unknown Step ${step}`;
}

/**
 * Check if categorization matches original type
 */
export function doesCategorizationMatch(result: VlmCategorizationResult): boolean {
  if (result.original_step === null) return false;
  return result.vlm_predicted_step === result.original_step;
}

/**
 * Get categorization confidence level
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}
