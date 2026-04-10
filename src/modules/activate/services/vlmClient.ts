/**
 * VLM Client
 *
 * Purpose: Base HTTP client for the Vision Language Model API.
 * Handles request building, response parsing, image preprocessing,
 * and feature flags shared across all VLM extraction modules.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log, createLogger } from '@/lib/logger';
import {
  detectBlur,
  preprocessImage,
  optimizeForVlm,
  type BlurDetectionResult,
} from './imagePreprocessService';

// Component logger
export const vlmLogger = createLogger('VlmExtraction');

// ============================================================================
// FEATURE FLAGS
// ============================================================================

/** Enable barcode extraction before VLM (default on) */
export const ENABLE_BARCODE_EXTRACTION =
  process.env.ENABLE_BARCODE_EXTRACTION !== 'false';

/** Enable full image preprocessing — deblur via NAFNet (default off) */
export const ENABLE_IMAGE_PREPROCESSING =
  process.env.ENABLE_IMAGE_PREPROCESSING === 'true';

/** Enable blur detection logging only, no deblur (default on) */
export const ENABLE_BLUR_DETECTION =
  process.env.ENABLE_BLUR_DETECTION !== 'false';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const VLM_API_BASE =
  process.env.VLM_API_URL || 'http://100.96.203.105:8100';
export const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
export const VLM_MODEL =
  process.env.VLM_EXTRACTION_MODEL || process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-32B-Instruct-AWQ';
export const VLM_TIMEOUT_MS = 60000; // 1 minute per extraction
export const VLM_TEMPERATURE = 0.1; // Low for consistent extraction

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Power meter extraction result
 */
export interface PowerMeterExtraction {
  success: boolean;
  value: number | null;
  unit: 'dBm';
  confidence: number;
  rawText: string | null;
  error?: string;
}

/**
 * Serial extraction result
 */
export interface SerialExtraction {
  success: boolean;
  serial: string | null;
  confidence: number;
  location: 'back' | 'front_label' | 'unknown';
  rawText: string | null;
  error?: string;
  /** How the serial was extracted: 'barcode' (high reliability) or 'vlm' (OCR) */
  extractionMethod?: 'barcode' | 'vlm';
}

/**
 * Serial confirmation result (when we have expected serial from OneMap)
 */
export interface SerialConfirmation {
  /** Whether the expected serial is visible in the photo */
  confirmed: boolean;
  /** How confident the VLM is (0.0 to 1.0) */
  confidence: number;
  /** The expected serial we were looking for */
  expectedSerial: string;
  /** What the VLM actually saw (may differ slightly due to angle/blur) */
  visibleText: string | null;
  /** If not confirmed, what serial was visible instead (if any) */
  alternativeSerial: string | null;
  /** Processing details */
  details: string;
}

/**
 * DR number extraction result
 */
export interface DrNumberExtraction {
  success: boolean;
  drNumber: string | null;
  confidence: number;
  rawText: string | null;
  error?: string;
}

/**
 * Combined Step 9 extraction (front panel)
 */
export interface Step9Extraction {
  ontSerial: SerialExtraction;
  drNumber: DrNumberExtraction;
  greenLightsVisible: boolean;
  processingTimeMs: number;
}

/**
 * Full extraction result for a DR
 */
export interface FullExtractionResult {
  drNumber: string;
  powerMeter: PowerMeterExtraction | null;
  ontSerialStep6: SerialExtraction | null;
  step9: Step9Extraction | null;
  /** Serial confirmation result (when OneMap serial was provided) */
  serialConfirmation?: SerialConfirmation | null;
  /** Whether confirmation mode was used (true) or extraction mode (false) */
  usedConfirmationMode: boolean;
  totalProcessingTimeMs: number;
  error?: string;
}

// ============================================================================
// VLM HTTP CLIENT
// ============================================================================

/**
 * Call VLM API with image and prompt.
 * Parses JSON from the model response, handling markdown code-block wrappers.
 */
export async function callVlmExtraction<T>(
  base64Image: string,
  prompt: string,
  context: string
): Promise<{ success: boolean; data: T | null; error?: string }> {
  const requestBody = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}` },
          },
        ],
      },
    ],
    max_tokens: 1000,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VLM API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in VLM response');
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];

    const parsed = JSON.parse(jsonMatch[1] || content);

    return { success: true, data: parsed };
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    const message = error instanceof Error ? error.message : String(error);
    log.error(`${context}: ${message}`, undefined, 'VlmExtraction');

    return { success: false, data: null, error: message };
  }
}

// ============================================================================
// IMAGE PREPROCESSING
// ============================================================================

/**
 * Preprocess image before VLM extraction.
 * Detects blur, optionally deblurs, and optimizes image dimensions for the VLM.
 */
export async function preprocessForVlm(
  base64: string,
  context: string
): Promise<{ base64: string; blurResult?: BlurDetectionResult }> {
  // If all preprocessing is disabled, just optimize size
  if (!ENABLE_BLUR_DETECTION && !ENABLE_IMAGE_PREPROCESSING) {
    const optimized = await optimizeForVlm(base64);
    return { base64: optimized };
  }

  // Detect blur
  const blurResult = await detectBlur(base64);

  if (blurResult.isBlurry) {
    vlmLogger.warn(
      `${context}: Image is ${blurResult.assessment} (score: ${blurResult.score.toFixed(1)})`,
      { score: blurResult.score, threshold: blurResult.threshold }
    );

    // If full preprocessing is enabled, try to deblur
    if (ENABLE_IMAGE_PREPROCESSING) {
      const preprocessResult = await preprocessImage(base64, {
        skipDeblur: false,
      });

      if (
        preprocessResult.wasPreprocessed &&
        preprocessResult.deblur?.newScore
      ) {
        vlmLogger.info(
          `${context}: Deblurred image (${blurResult.score.toFixed(1)} → ${preprocessResult.deblur.newScore.toFixed(1)})`
        );
        return { base64: preprocessResult.imageBase64, blurResult };
      }
    }
  } else {
    vlmLogger.debug(
      `${context}: Image is ${blurResult.assessment} (score: ${blurResult.score.toFixed(1)})`
    );
  }

  // Optimize for VLM (resize if needed)
  const optimized = await optimizeForVlm(base64);
  return { base64: optimized, blurResult };
}
