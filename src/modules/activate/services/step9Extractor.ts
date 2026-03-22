/**
 * Step 9 Extractor
 *
 * Purpose: Extract data from Step 9 (front panel) photos — ONT serial,
 * DR number, and green LED status. Also handles serial confirmation mode
 * (when OneMap already has the serial) and multi-photo consensus for
 * both Step 6 and Step 9.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { fetchPhotoAsBase64 } from './photoFetchService';
import { extractOntSerialFromBarcode } from './barcodeExtractionService';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
} from '@/services/vlmLearningService';
import { log } from '@/lib/logger';
import {
  vlmLogger,
  callVlmExtraction,
  preprocessForVlm,
  ENABLE_BARCODE_EXTRACTION,
  type SerialExtraction,
  type SerialConfirmation,
  type Step9Extraction,
} from './vlmClient';
import {
  isValidOntSerial,
  normalizeSerial,
  extractOntSerialFromBack,
} from './serialExtractor';
import { STEP9_FRONT_PROMPT } from './vlmPrompts';

// ============================================================================
// STEP 9 EXTRACTION
// ============================================================================

/**
 * Extract data from Step 9 photo (front of ONT with labels).
 * Uses barcode-first approach for ONT serial, VLM for DR number and green lights.
 *
 * @param photoUrl - URL of the Step 9 photo
 * @returns Step 9 extraction result
 */
export async function extractStep9Data(
  photoUrl: string
): Promise<Step9Extraction> {
  const startTime = Date.now();
  vlmLogger.debug(`Extracting Step 9 data from: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);
    const preprocessed = await preprocessForVlm(base64, 'Step 9 front');
    base64 = preprocessed.base64;

    // Step 1: Try barcode scanning for ONT serial first
    let barcodeSerial: SerialExtraction | null = null;
    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        vlmLogger.debug('Attempting barcode scan for Step 9 ONT serial');
        const barcodeResult = await extractOntSerialFromBarcode(base64);

        if (barcodeResult.success && barcodeResult.serial) {
          vlmLogger.info(`Step 9 barcode scan successful: ${barcodeResult.serial} (${barcodeResult.format})`);
          barcodeSerial = {
            success: true,
            serial: barcodeResult.serial,
            confidence: barcodeResult.confidence,
            location: 'front_label',
            rawText: `Barcode (${barcodeResult.format}): ${barcodeResult.serial}`,
            extractionMethod: 'barcode',
          };
        } else {
          vlmLogger.debug('No barcode found in Step 9, will use VLM');
        }
      } catch (barcodeError) {
        vlmLogger.warn(`Step 9 barcode scan error: ${barcodeError}`);
      }
    }

    // Step 2: Always call VLM for DR number and green lights (and serial fallback)
    let step9Prompt = STEP9_FRONT_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'activate',
        analysisType: 'ont_serial_front',
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      if (examples.length > 0) {
        const fewShotSection = buildVlmFewShotPrompt(examples);
        step9Prompt = `${STEP9_FRONT_PROMPT}\n\n${fewShotSection}`;
        vlmLogger.debug(`Injected ${examples.length} few-shot examples for Step 9`);
      }
    } catch (fewShotError) {
      vlmLogger.warn(`Few-shot retrieval failed for Step 9: ${fewShotError}`);
    }

    const result = await callVlmExtraction<{
      greenLightsVisible: boolean;
      ontSerial: { found: boolean; serial: string | null; rawText: string | null; confidence: number };
      drNumber: { found: boolean; drNumber: string | null; rawText: string | null; confidence: number };
    }>(base64, step9Prompt, 'Step 9 front extraction');

    if (!result.success || !result.data) {
      return {
        ontSerial: barcodeSerial || {
          success: false, serial: null, confidence: 0,
          location: 'front_label', rawText: null, error: result.error, extractionMethod: 'vlm',
        },
        drNumber: { success: false, drNumber: null, confidence: 0, rawText: null, error: result.error },
        greenLightsVisible: false,
        processingTimeMs: Date.now() - startTime,
      };
    }

    const { greenLightsVisible, ontSerial, drNumber } = result.data;

    let finalOntSerial: SerialExtraction;
    if (barcodeSerial) {
      finalOntSerial = barcodeSerial;
    } else {
      const normalizedSerial = normalizeSerial(ontSerial.serial);
      const isValid = isValidOntSerial(normalizedSerial);

      if (ontSerial.found && ontSerial.serial && !isValid) {
        vlmLogger.warn(`Step 9 VLM returned invalid serial "${ontSerial.serial}" (likely SSID or wrong field)`);
      }

      finalOntSerial = {
        success: ontSerial.found && isValid,
        serial: isValid ? normalizedSerial : null,
        confidence: isValid ? ontSerial.confidence || 0 : 0,
        location: 'front_label',
        rawText: ontSerial.rawText || null,
        error: ontSerial.found && !isValid ? `Invalid serial format: ${ontSerial.serial}` : undefined,
        extractionMethod: 'vlm',
      };
    }

    return {
      ontSerial: finalOntSerial,
      drNumber: {
        success: drNumber.found && !!drNumber.drNumber,
        drNumber: drNumber.found ? drNumber.drNumber : null,
        confidence: drNumber.confidence || 0,
        rawText: drNumber.rawText || null,
      },
      greenLightsVisible: greenLightsVisible || false,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Step 9 extraction failed: ${message}`, undefined, 'VlmExtraction');

    return {
      ontSerial: { success: false, serial: null, confidence: 0, location: 'front_label', rawText: null, error: message, extractionMethod: 'vlm' },
      drNumber: { success: false, drNumber: null, confidence: 0, rawText: null, error: message },
      greenLightsVisible: false,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// SERIAL CONFIRMATION (when OneMap has the serial)
// ============================================================================

function buildSerialConfirmationPrompt(expectedSerial: string): string {
  return `You are verifying that a specific ONT serial number is visible in this photo.

EXPECTED SERIAL: ${expectedSerial}

Your task: Check if this exact serial (or very close match) is visible anywhere in the photo.

The serial should:
- Start with "ALCLB4" and be exactly 12 characters
- Be on a white sticker/label
- May be near a barcode or under "S/N:" text

Respond in this exact JSON format:
{
  "confirmed": true/false,
  "confidence": <0.0 to 1.0>,
  "visibleText": "<what you actually see on the label, or null>",
  "alternativeSerial": "<if you see a DIFFERENT serial starting with ALCL/ALCB, put it here, otherwise null>",
  "details": "<brief explanation of what you found>"
}

IMPORTANT:
- "confirmed": true means you can see "${expectedSerial}" or a very close match (1-2 character difference is OK)
- If the serial is partially obscured but you can make out most of it matching, that's confirmed
- If you see a completely different serial, set confirmed=false and put it in alternativeSerial
- If you can't see any serial clearly, set confirmed=false with null alternativeSerial`;
}

/**
 * Confirm that an expected serial is visible in a photo.
 * More accurate than extraction when OneMap already has the serial.
 */
export async function confirmSerialVisible(
  photoUrl: string,
  expectedSerial: string
): Promise<SerialConfirmation> {
  vlmLogger.debug(`Confirming serial ${expectedSerial} is visible in photo`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);
    const preprocessed = await preprocessForVlm(base64, 'Serial confirmation');
    base64 = preprocessed.base64;

    const prompt = buildSerialConfirmationPrompt(expectedSerial);

    const result = await callVlmExtraction<{
      confirmed: boolean;
      confidence: number;
      visibleText: string | null;
      alternativeSerial: string | null;
      details: string;
    }>(base64, prompt, `Serial confirmation for ${expectedSerial}`);

    if (!result.success || !result.data) {
      return {
        confirmed: false, confidence: 0, expectedSerial,
        visibleText: null, alternativeSerial: null,
        details: result.error || 'VLM confirmation failed',
      };
    }

    const { confirmed, confidence, visibleText, alternativeSerial, details } = result.data;

    const validAltSerial = alternativeSerial && isValidOntSerial(alternativeSerial)
      ? normalizeSerial(alternativeSerial)
      : null;

    vlmLogger.info(`Serial confirmation: ${confirmed ? '✓' : '✗'} ${expectedSerial} (confidence: ${confidence})`);
    if (!confirmed && validAltSerial) {
      vlmLogger.info(`Alternative serial found: ${validAltSerial}`);
    }

    return {
      confirmed, confidence: confidence || 0, expectedSerial,
      visibleText: visibleText || null,
      alternativeSerial: validAltSerial,
      details: details || '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Serial confirmation failed: ${message}`, undefined, 'VlmExtraction');
    return {
      confirmed: false, confidence: 0, expectedSerial,
      visibleText: null, alternativeSerial: null,
      details: `Error: ${message}`,
    };
  }
}

/**
 * Confirm serial from multiple photos — returns first confirmed or best alternative.
 */
export async function confirmSerialFromMultiplePhotos(
  photoUrls: string[],
  expectedSerial: string
): Promise<{ result: SerialConfirmation; usedUrl: string | null }> {
  if (photoUrls.length === 0) {
    return {
      result: { confirmed: false, confidence: 0, expectedSerial, visibleText: null, alternativeSerial: null, details: 'No photos provided' },
      usedUrl: null,
    };
  }

  vlmLogger.info(`Confirming ${expectedSerial} across ${photoUrls.length} photos`);

  let bestResult: SerialConfirmation | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of photoUrls) {
    try {
      const result = await confirmSerialVisible(url, expectedSerial);
      const score = result.confirmed
        ? 10 + result.confidence
        : result.confidence + (result.alternativeSerial ? 2 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      if (result.confirmed && result.confidence >= 0.8) {
        vlmLogger.info(`Serial confirmed in ${url.split('/').pop()}`);
        break;
      }
    } catch (error) {
      vlmLogger.warn(`Failed to check ${url}: ${error}`);
    }
  }

  return {
    result: bestResult || {
      confirmed: false, confidence: 0, expectedSerial,
      visibleText: null, alternativeSerial: null, details: 'All photo checks failed',
    },
    usedUrl: bestUrl,
  };
}

// ============================================================================
// MULTI-PHOTO HELPERS
// ============================================================================

/**
 * Try extracting ONT serial from multiple Step 6 photos, return best result.
 */
export async function extractOntSerialWithMultiplePhotos(
  step6Urls: string[]
): Promise<{ result: SerialExtraction | null; usedUrl: string | null }> {
  if (step6Urls.length === 0) return { result: null, usedUrl: null };

  vlmLogger.info(`Trying ${step6Urls.length} Step 6 photos for ONT serial extraction`);

  let bestResult: SerialExtraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step6Urls) {
    try {
      const result = await extractOntSerialFromBack(url);
      const score = result.success ? 2 + result.confidence : 0;

      vlmLogger.debug(`Step 6 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, serial=${result.serial}`);

      if (score > bestScore) { bestScore = score; bestResult = result; bestUrl = url; }

      if (result.success && result.confidence >= 0.9) {
        vlmLogger.info('Found high-confidence ONT serial, stopping early');
        break;
      }
    } catch (error) {
      vlmLogger.warn(`Failed to extract ONT serial from ${url}: ${error}`);
    }
  }

  if (bestResult?.success) {
    vlmLogger.info(`Best Step 6 photo: ${bestUrl?.split('/').pop()}, serial=${bestResult.serial}`);
  } else {
    vlmLogger.warn(`No successful ONT serial extraction from ${step6Urls.length} photos`);
  }

  return { result: bestResult, usedUrl: bestUrl };
}

/**
 * Try extracting Step 9 data from multiple photos, return best result.
 */
export async function extractStep9WithMultiplePhotos(
  step9Urls: string[]
): Promise<{ result: Step9Extraction | null; usedUrl: string | null }> {
  if (step9Urls.length === 0) return { result: null, usedUrl: null };

  vlmLogger.info(`Trying ${step9Urls.length} Step 9 photos for extraction`);

  let bestResult: Step9Extraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step9Urls) {
    try {
      const result = await extractStep9Data(url);

      let score = 0;
      if (result.ontSerial.success) score += 2 + result.ontSerial.confidence;
      if (result.drNumber.success) score += 2 + result.drNumber.confidence;
      if (result.greenLightsVisible) score += 1;

      vlmLogger.debug(`Step 9 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, serial=${result.ontSerial.serial}, DR=${result.drNumber.drNumber}`);

      if (score > bestScore) { bestScore = score; bestResult = result; bestUrl = url; }

      if (result.ontSerial.success && result.drNumber.success &&
          result.ontSerial.confidence >= 0.8 && result.drNumber.confidence >= 0.8) {
        vlmLogger.info('Found high-confidence Step 9 result, stopping early');
        break;
      }
    } catch (error) {
      vlmLogger.warn(`Failed to extract from ${url}: ${error}`);
    }
  }

  if (bestResult) {
    vlmLogger.info(`Best Step 9 photo: ${bestUrl?.split('/').pop()}, score=${bestScore.toFixed(2)}`);
  } else {
    vlmLogger.warn(`No successful Step 9 extraction from ${step9Urls.length} photos`);
  }

  return { result: bestResult, usedUrl: bestUrl };
}
