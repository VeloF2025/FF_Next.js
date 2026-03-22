/**
 * Power Meter Extractor
 *
 * Purpose: Extract dBm power-meter readings from Step 7 installation photos
 * using the VLM with few-shot learning from past corrections.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { fetchPhotoAsBase64 } from './photoFetchService';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
} from '@/services/vlmLearningService';
import { log } from '@/lib/logger';
import {
  vlmLogger,
  callVlmExtraction,
  preprocessForVlm,
  type PowerMeterExtraction,
} from './vlmClient';

// ============================================================================
// PROMPT
// ============================================================================

const POWER_METER_PROMPT = `You are extracting the power meter reading from a fiber optic installation photo.

Look for a power meter device display showing a dBm (decibel-milliwatts) reading.
The reading is typically a negative number between -5 and -35 dBm.

Respond in this exact JSON format:
{
  "found": true/false,
  "value": <number or null>,
  "rawText": "<exact text shown on display>",
  "confidence": <0.0 to 1.0>
}

If you cannot find a readable power meter display, set found to false.
Only extract the dBm value, not other readings.`;

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Extract power meter reading from a Step 7 photo.
 * Enhanced with few-shot learning from past corrections.
 *
 * @param photoUrl - URL of the Step 7 photo
 * @returns Power meter extraction result
 */
export async function extractPowerMeterReading(
  photoUrl: string
): Promise<PowerMeterExtraction> {
  vlmLogger.debug(`Extracting power meter reading from ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    // Preprocess image (blur detection + optimization)
    const preprocessed = await preprocessForVlm(base64, 'Power meter');
    base64 = preprocessed.base64;

    // Get few-shot examples from past corrections (non-blocking)
    let enhancedPrompt = POWER_METER_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'activate',
        analysisType: 'power_meter_dbm',
        maxExamples: 2,
        prioritizeCanonical: true,
      });
      if (examples.length > 0) {
        const fewShotSection = buildVlmFewShotPrompt(examples);
        enhancedPrompt = `${POWER_METER_PROMPT}\n\n${fewShotSection}`;
        vlmLogger.debug(
          `Injected ${examples.length} few-shot examples for power meter`
        );
      }
    } catch (fewShotError) {
      vlmLogger.warn(`Few-shot retrieval failed: ${fewShotError}`);
    }

    const result = await callVlmExtraction<{
      found: boolean;
      value: number | null;
      rawText: string | null;
      confidence: number;
    }>(base64, enhancedPrompt, 'Power meter extraction');

    if (!result.success || !result.data) {
      return {
        success: false,
        value: null,
        unit: 'dBm',
        confidence: 0,
        rawText: null,
        error: result.error || 'Extraction failed',
      };
    }

    const { found, value, rawText, confidence } = result.data;

    // Record successful extraction metric (non-blocking)
    if (found && value !== null && confidence >= 0.7) {
      recordCorrectExtraction('activate', 'power_meter_dbm', confidence).catch(
        () => {
          // Silently ignore metric recording failures
        }
      );
    }

    return {
      success: found && value !== null,
      value: found ? value : null,
      unit: 'dBm',
      confidence: confidence || 0,
      rawText: rawText || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      `Power meter extraction failed: ${message}`,
      undefined,
      'VlmExtraction'
    );

    return {
      success: false,
      value: null,
      unit: 'dBm',
      confidence: 0,
      rawText: null,
      error: message,
    };
  }
}

// ============================================================================
// MULTI-PHOTO
// ============================================================================

/**
 * Try extracting a power meter reading from multiple Step 7 photos.
 * Returns the result with the highest confidence score.
 *
 * @param step7Urls - Array of Step 7 photo URLs
 * @returns Best extraction result and the URL it came from
 */
export async function extractPowerMeterWithMultiplePhotos(
  step7Urls: string[]
): Promise<{ result: PowerMeterExtraction | null; usedUrl: string | null }> {
  if (step7Urls.length === 0) {
    return { result: null, usedUrl: null };
  }

  vlmLogger.info(
    `Trying ${step7Urls.length} Step 7 photos for power meter extraction`
  );

  let bestResult: PowerMeterExtraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step7Urls) {
    try {
      const result = await extractPowerMeterReading(url);

      // Score based on success and confidence
      const score = result.success ? 2 + result.confidence : 0;

      vlmLogger.debug(
        `Step 7 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, value=${result.value}`
      );

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      // Stop early if we got a successful high-confidence extraction
      if (result.success && result.confidence >= 0.9) {
        vlmLogger.info(
          `Found high-confidence power meter reading, stopping early`
        );
        break;
      }
    } catch (error) {
      vlmLogger.warn(`Failed to extract power meter from ${url}: ${error}`);
    }
  }

  if (bestResult?.success) {
    vlmLogger.info(
      `Best Step 7 photo: ${bestUrl?.split('/').pop()}, value=${bestResult.value}`
    );
  } else {
    vlmLogger.warn(
      `No successful power meter extraction from ${step7Urls.length} photos`
    );
  }

  return { result: bestResult, usedUrl: bestUrl };
}
