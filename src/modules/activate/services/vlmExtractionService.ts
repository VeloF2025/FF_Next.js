/**
 * VLM Extraction Service
 *
 * Purpose: Extract specific data from installation photos using VLM
 * - Power meter dBm reading from Step 7
 * - ONT serial from Step 6 (back) and Step 9 (front label)
 * - DR number from Step 9 (front label)
 *
 * Status: WORKING - Phase 3 Data Validation support
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - Single responsibility - extraction only
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from './photoFetchService';
import { extractOntSerialFromBarcode } from './barcodeExtractionService';
import {
  detectBlur,
  preprocessImage,
  optimizeForVlm,
  type BlurDetectionResult,
  type PreprocessResult,
} from './imagePreprocessService';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
} from '@/services/vlmLearningService';

// Feature flag for barcode extraction
const ENABLE_BARCODE_EXTRACTION = process.env.ENABLE_BARCODE_EXTRACTION !== 'false'; // Enabled by default

// Feature flag for image preprocessing (blur detection + deblur)
const ENABLE_IMAGE_PREPROCESSING = process.env.ENABLE_IMAGE_PREPROCESSING === 'true'; // Disabled by default until NAFNet is set up

// Feature flag for blur detection only (no deblur, just logging)
const ENABLE_BLUR_DETECTION = process.env.ENABLE_BLUR_DETECTION !== 'false'; // Enabled by default

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 60000; // 1 minute per extraction
const VLM_TEMPERATURE = 0.1; // Low for consistent extraction

// ============================================================================
// TYPES
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
// PROMPTS
// ============================================================================

/**
 * Prompt for power meter reading extraction
 */
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

/**
 * Prompt for ONT serial extraction from back (Step 6)
 *
 * CRITICAL: Nokia labels have multiple fields that look similar:
 * - S/N: ALCLB6A9C97 ← THIS IS THE SERIAL (starts with ALCL or ALCB)
 * - SSID: ALHN-C397 ← NOT the serial (starts with ALHN)
 * - ONT P/N: STN0145844A ← NOT the serial (model/part number)
 * - MAC ID: 804E3CBE680 ← NOT the serial (MAC address)
 */
const ONT_SERIAL_BACK_PROMPT = `You are extracting the ONT serial number from a Nokia/Alcatel device label.

CRITICAL: The label has MULTIPLE fields. You must find the CORRECT one:

✅ CORRECT - Find the "S/N:" field (Serial Number):
   - Starts with "ALCL" or "ALCB" followed by 7-8 alphanumeric characters
   - Exactly 11-12 characters total
   - Located on a WHITE sticker, usually has a barcode above it

❌ WRONG - Do NOT extract these fields:
   - SSID fields (start with "ALHN-" like ALHN-C397) - these are WiFi names
   - ONT P/N (like STN0145844A) - this is the part/model number
   - MAC ID (like 804E3CBE680) - this is the MAC address
   - Admin IP (like 192.168.1.254) - this is an IP address

The S/N field is typically:
- On the main white product label
- Below the MAC ID line
- Above or near the barcode
- Format: S/N: ALCLXXXXXXXX or SN: ALCLXXXXXXXX

Read the ACTUAL text from the photo. Do NOT guess or invent serial numbers.

Respond in this exact JSON format:
{
  "found": true/false,
  "serial": "<serial starting with ALCL or ALCB, or null>",
  "rawText": "<exact text you read from the S/N field>",
  "confidence": <0.0 to 1.0>
}

IMPORTANT: If you cannot find a field starting with ALCL or ALCB, set found to false.
Do NOT return SSID values (ALHN-*) as the serial.
NEVER return a serial you are not sure about - null is better than wrong.`;

/**
 * Prompt for Step 9 front panel extraction (ONT serial + DR number)
 *
 * Step 9 shows the FRONT of the ONT with green lights and labels attached
 */
const STEP9_FRONT_PROMPT = `You are analyzing the FRONT of a Nokia/Alcatel ONT device with installation labels.

Look for these THREE items:

1. GREEN STATUS LIGHTS - Are the indicator LEDs illuminated (green)?
   - Look for lit LEDs labeled POWER, PON, LAN, WLAN, etc.

2. ONT SERIAL NUMBER - A sticker/label with the device serial:
   ✅ CORRECT: Starts with "ALCL" or "ALCB" followed by 7-8 alphanumeric characters
   ❌ WRONG: Do NOT extract SSID (starts with "ALHN-" like ALHN-C397)
   - The serial is 11-12 characters total
   - May be on a small white sticker on the front
   - Read the ACTUAL text, do NOT guess

3. DR NUMBER - A handwritten or printed label:
   - Format: "DR" followed by 6-7 digits (e.g., DR1736721)
   - Often on a yellow/white sticker or written on tape
   - This is the drop/installation reference number

Respond in this exact JSON format:
{
  "greenLightsVisible": true/false,
  "ontSerial": {
    "found": true/false,
    "serial": "<serial starting with ALCL or ALCB, or null>",
    "rawText": "<exact text from label>",
    "confidence": <0.0 to 1.0>
  },
  "drNumber": {
    "found": true/false,
    "drNumber": "<DR number like DR1234567, or null>",
    "rawText": "<exact text from label>",
    "confidence": <0.0 to 1.0>
  }
}

IMPORTANT: Only extract serials starting with ALCL or ALCB. Ignore SSID values (ALHN-*).`;

/**
 * Build a confirmation prompt for verifying a known serial is visible
 * This is used when OneMap already has the serial - we just confirm it's in the photo
 */
function buildSerialConfirmationPrompt(expectedSerial: string): string {
  return `You are verifying that a specific ONT serial number is visible in this photo.

EXPECTED SERIAL: ${expectedSerial}

Your task: Check if this exact serial (or very close match) is visible anywhere in the photo.

The serial should:
- Start with "ALCL" or "ALCB"
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

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate ONT serial format
 * - Must start with ALCL or ALCB
 * - Must be 11-12 characters
 * - Must NOT be an SSID (ALHN-*)
 */
function isValidOntSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();

  // Hallucination guard — reject prompt examples
  if (isPromptExampleSerial(s)) return false;

  // Reject SSID patterns (common VLM mistake)
  if (s.startsWith('ALHN') || s.startsWith('ALH-') || s.includes('-')) {
    log.debug('VlmExtraction', `Rejected SSID-like value: ${serial}`);
    return false;
  }

  // Must start with ALCL or ALCB
  if (!s.startsWith('ALCL') && !s.startsWith('ALCB')) {
    log.debug('VlmExtraction', `Rejected non-ALC serial: ${serial}`);
    return false;
  }

  // Should be 11-12 chars (allowing some flexibility for OCR errors)
  if (s.length < 10 || s.length > 14) {
    log.debug('VlmExtraction', `Rejected serial with wrong length (${s.length}): ${serial}`);
    return false;
  }

  return true;
}

/**
 * Clean and normalize extracted serial
 * Fixes common OCR errors like missing characters
 */
function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  let s = serial.trim().toUpperCase();

  // Remove any spaces or dashes that shouldn't be there
  s = s.replace(/[\s-]/g, '');

  return s;
}

// ============================================================================
// VLM API CALL
// ============================================================================

/**
 * Call VLM API with image and prompt
 */
async function callVlmExtraction<T>(
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
    log.error('VlmExtraction', `${context}: ${message}`);

    return { success: false, data: null, error: message };
  }
}

// ============================================================================
// IMAGE PREPROCESSING
// ============================================================================

/**
 * Preprocess image before VLM extraction
 * - Detects blur and optionally deblurs
 * - Optimizes image size for VLM
 *
 * @param base64 - Base64 encoded image
 * @param context - Context for logging
 * @returns Preprocessed base64 image
 */
async function preprocessForVlm(
  base64: string,
  context: string
): Promise<{ base64: string; blurResult?: BlurDetectionResult }> {
  // If preprocessing is disabled, just optimize size
  if (!ENABLE_BLUR_DETECTION && !ENABLE_IMAGE_PREPROCESSING) {
    const optimized = await optimizeForVlm(base64);
    return { base64: optimized };
  }

  // Detect blur
  const blurResult = await detectBlur(base64);

  if (blurResult.isBlurry) {
    log.warn('VlmExtraction', `${context}: Image is ${blurResult.assessment} (score: ${blurResult.score.toFixed(1)})`, {
      score: blurResult.score,
      threshold: blurResult.threshold,
    });

    // If full preprocessing is enabled, try to deblur
    if (ENABLE_IMAGE_PREPROCESSING) {
      const preprocessResult = await preprocessImage(base64, { skipDeblur: false });

      if (preprocessResult.wasPreprocessed && preprocessResult.deblur?.newScore) {
        log.info('VlmExtraction', `${context}: Deblurred image (${blurResult.score.toFixed(1)} → ${preprocessResult.deblur.newScore.toFixed(1)})`);
        return { base64: preprocessResult.imageBase64, blurResult };
      }
    }
  } else {
    log.debug('VlmExtraction', `${context}: Image is ${blurResult.assessment} (score: ${blurResult.score.toFixed(1)})`);
  }

  // Optimize for VLM (resize if needed)
  const optimized = await optimizeForVlm(base64);
  return { base64: optimized, blurResult };
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract power meter reading from Step 7 photo
 * Enhanced with few-shot learning from past corrections
 */
export async function extractPowerMeterReading(photoUrl: string): Promise<PowerMeterExtraction> {
  log.debug('VlmExtraction', `Extracting power meter reading from ${photoUrl}`);

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
        log.debug('VlmExtraction', `Injected ${examples.length} few-shot examples for power meter`);
      }
    } catch (fewShotError) {
      log.warn('VlmExtraction', `Few-shot retrieval failed: ${fewShotError}`);
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
      recordCorrectExtraction('activate', 'power_meter_dbm', confidence).catch(() => {
        // Silently ignore metric recording failures
      });
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
    log.error('VlmExtraction', `Power meter extraction failed: ${message}`);

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

/**
 * Extract ONT serial from Step 6 photo (back of ONT) using VLM only
 * Enhanced with few-shot learning from past corrections
 * (Internal function - use extractOntSerialFromBack for barcode-first approach)
 */
async function extractOntSerialFromBackViaVlm(base64: string): Promise<SerialExtraction> {
  // Get few-shot examples from past corrections (non-blocking)
  let enhancedPrompt = ONT_SERIAL_BACK_PROMPT;
  try {
    const examples = await getVlmFewShotExamples({
      module: 'activate',
      analysisType: 'ont_serial_back',
      maxExamples: 3,
      prioritizeCanonical: true,
    });
    if (examples.length > 0) {
      const fewShotSection = buildVlmFewShotPrompt(examples);
      enhancedPrompt = `${ONT_SERIAL_BACK_PROMPT}\n\n${fewShotSection}`;
      log.debug('VlmExtraction', `Injected ${examples.length} few-shot examples for ONT serial`);
    }
  } catch (fewShotError) {
    log.warn('VlmExtraction', `Few-shot retrieval failed: ${fewShotError}`);
  }

  const result = await callVlmExtraction<{
    found: boolean;
    serial: string | null;
    rawText: string | null;
    confidence: number;
  }>(base64, enhancedPrompt, 'ONT serial back extraction');

  if (!result.success || !result.data) {
    return {
      success: false,
      serial: null,
      confidence: 0,
      location: 'back',
      rawText: null,
      error: result.error || 'Extraction failed',
      extractionMethod: 'vlm',
    };
  }

  const { found, serial, rawText, confidence } = result.data;

  // Normalize and validate the extracted serial
  const normalizedSerial = normalizeSerial(serial);
  const isValid = isValidOntSerial(normalizedSerial);

  if (found && serial && !isValid) {
    log.warn('VlmExtraction', `VLM returned invalid serial "${serial}" (likely SSID or wrong field)`);
  }

  // Record successful extraction metric (non-blocking)
  if (found && isValid && confidence >= 0.7) {
    recordCorrectExtraction('activate', 'ont_serial_back', confidence).catch(() => {
      // Silently ignore metric recording failures
    });
  }

  return {
    success: found && isValid,
    serial: isValid ? normalizedSerial : null,
    confidence: isValid ? (confidence || 0) : 0,
    location: 'back',
    rawText: rawText || null,
    error: found && !isValid ? `Invalid serial format: ${serial}` : undefined,
    extractionMethod: 'vlm',
  };
}

/**
 * Extract ONT serial from Step 6 photo (back of ONT)
 * Uses barcode scanning first, falls back to VLM if no barcode found
 */
export async function extractOntSerialFromBack(photoUrl: string): Promise<SerialExtraction> {
  log.debug('VlmExtraction', `Extracting ONT serial from back: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    // Preprocess image (blur detection + optimization)
    const preprocessed = await preprocessForVlm(base64, 'Step 6 ONT serial');
    base64 = preprocessed.base64;

    // Step 1: Try barcode scanning first (faster, more reliable)
    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        log.debug('VlmExtraction', 'Attempting barcode scan for ONT serial');
        const barcodeResult = await extractOntSerialFromBarcode(base64);

        if (barcodeResult.success && barcodeResult.serial) {
          log.info('VlmExtraction', `Barcode scan successful: ${barcodeResult.serial} (${barcodeResult.format})`);
          return {
            success: true,
            serial: barcodeResult.serial,
            confidence: barcodeResult.confidence,
            location: 'back',
            rawText: `Barcode (${barcodeResult.format}): ${barcodeResult.serial}`,
            extractionMethod: 'barcode',
          };
        }
        log.debug('VlmExtraction', 'No barcode found, falling back to VLM');
      } catch (barcodeError) {
        log.warn('VlmExtraction', `Barcode scan error: ${barcodeError}, falling back to VLM`);
      }
    }

    // Step 2: Fall back to VLM extraction (image already preprocessed)
    return extractOntSerialFromBackViaVlm(base64);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('VlmExtraction', `ONT serial back extraction failed: ${message}`);

    return {
      success: false,
      serial: null,
      confidence: 0,
      location: 'back',
      rawText: null,
      error: message,
      extractionMethod: 'vlm',
    };
  }
}

/**
 * Extract data from Step 9 photo (front of ONT with labels)
 * Uses barcode-first approach for ONT serial, VLM for DR number and green lights
 */
export async function extractStep9Data(photoUrl: string): Promise<Step9Extraction> {
  const startTime = Date.now();
  log.debug('VlmExtraction', `Extracting Step 9 data from: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    // Preprocess image (blur detection + optimization)
    const preprocessed = await preprocessForVlm(base64, 'Step 9 front');
    base64 = preprocessed.base64;

    // Step 1: Try barcode scanning for ONT serial first (faster, more reliable)
    let barcodeSerial: SerialExtraction | null = null;
    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        log.debug('VlmExtraction', 'Attempting barcode scan for Step 9 ONT serial');
        const barcodeResult = await extractOntSerialFromBarcode(base64);

        if (barcodeResult.success && barcodeResult.serial) {
          log.info('VlmExtraction', `Step 9 barcode scan successful: ${barcodeResult.serial} (${barcodeResult.format})`);
          barcodeSerial = {
            success: true,
            serial: barcodeResult.serial,
            confidence: barcodeResult.confidence,
            location: 'front_label',
            rawText: `Barcode (${barcodeResult.format}): ${barcodeResult.serial}`,
            extractionMethod: 'barcode',
          };
        } else {
          log.debug('VlmExtraction', 'No barcode found in Step 9, will use VLM');
        }
      } catch (barcodeError) {
        log.warn('VlmExtraction', `Step 9 barcode scan error: ${barcodeError}`);
      }
    }

    // Step 2: Always call VLM for DR number and green lights (and serial fallback)
    const result = await callVlmExtraction<{
      greenLightsVisible: boolean;
      ontSerial: {
        found: boolean;
        serial: string | null;
        rawText: string | null;
        confidence: number;
      };
      drNumber: {
        found: boolean;
        drNumber: string | null;
        rawText: string | null;
        confidence: number;
      };
    }>(base64, STEP9_FRONT_PROMPT, 'Step 9 front extraction');

    if (!result.success || !result.data) {
      // Even if VLM fails, return barcode result if we have it
      return {
        ontSerial: barcodeSerial || {
          success: false,
          serial: null,
          confidence: 0,
          location: 'front_label',
          rawText: null,
          error: result.error,
          extractionMethod: 'vlm',
        },
        drNumber: {
          success: false,
          drNumber: null,
          confidence: 0,
          rawText: null,
          error: result.error,
        },
        greenLightsVisible: false,
        processingTimeMs: Date.now() - startTime,
      };
    }

    const { greenLightsVisible, ontSerial, drNumber } = result.data;

    // Use barcode serial if available (higher reliability), otherwise VLM with validation
    let finalOntSerial: SerialExtraction;
    if (barcodeSerial) {
      finalOntSerial = barcodeSerial;
    } else {
      // Normalize and validate VLM result
      const normalizedSerial = normalizeSerial(ontSerial.serial);
      const isValid = isValidOntSerial(normalizedSerial);

      if (ontSerial.found && ontSerial.serial && !isValid) {
        log.warn('VlmExtraction', `Step 9 VLM returned invalid serial "${ontSerial.serial}" (likely SSID or wrong field)`);
      }

      finalOntSerial = {
        success: ontSerial.found && isValid,
        serial: isValid ? normalizedSerial : null,
        confidence: isValid ? (ontSerial.confidence || 0) : 0,
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
    log.error('VlmExtraction', `Step 9 extraction failed: ${message}`);

    return {
      ontSerial: {
        success: false,
        serial: null,
        confidence: 0,
        location: 'front_label',
        rawText: null,
        error: message,
        extractionMethod: 'vlm',
      },
      drNumber: {
        success: false,
        drNumber: null,
        confidence: 0,
        rawText: null,
        error: message,
      },
      greenLightsVisible: false,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// CONFIRMATION FUNCTIONS (when OneMap has the serial)
// ============================================================================

/**
 * Confirm that an expected serial is visible in a photo
 * Use this when OneMap already has the serial - more accurate than extraction
 *
 * @param photoUrl - URL of the photo to check
 * @param expectedSerial - The serial we expect to see (from OneMap)
 * @returns Confirmation result with details
 */
export async function confirmSerialVisible(
  photoUrl: string,
  expectedSerial: string
): Promise<SerialConfirmation> {
  log.debug('VlmExtraction', `Confirming serial ${expectedSerial} is visible in photo`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    // Preprocess image (blur detection + optimization)
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
        confirmed: false,
        confidence: 0,
        expectedSerial,
        visibleText: null,
        alternativeSerial: null,
        details: result.error || 'VLM confirmation failed',
      };
    }

    const { confirmed, confidence, visibleText, alternativeSerial, details } = result.data;

    // Validate alternativeSerial if provided
    const validAltSerial = alternativeSerial && isValidOntSerial(alternativeSerial)
      ? normalizeSerial(alternativeSerial)
      : null;

    log.info('VlmExtraction', `Serial confirmation: ${confirmed ? '✓' : '✗'} ${expectedSerial} (confidence: ${confidence})`);
    if (!confirmed && validAltSerial) {
      log.info('VlmExtraction', `Alternative serial found: ${validAltSerial}`);
    }

    return {
      confirmed,
      confidence: confidence || 0,
      expectedSerial,
      visibleText: visibleText || null,
      alternativeSerial: validAltSerial,
      details: details || '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('VlmExtraction', `Serial confirmation failed: ${message}`);

    return {
      confirmed: false,
      confidence: 0,
      expectedSerial,
      visibleText: null,
      alternativeSerial: null,
      details: `Error: ${message}`,
    };
  }
}

/**
 * Confirm serial from multiple photos - returns first confirmed or best alternative
 */
export async function confirmSerialFromMultiplePhotos(
  photoUrls: string[],
  expectedSerial: string
): Promise<{ result: SerialConfirmation; usedUrl: string | null }> {
  if (photoUrls.length === 0) {
    return {
      result: {
        confirmed: false,
        confidence: 0,
        expectedSerial,
        visibleText: null,
        alternativeSerial: null,
        details: 'No photos provided',
      },
      usedUrl: null,
    };
  }

  log.info('VlmExtraction', `Confirming ${expectedSerial} across ${photoUrls.length} photos`);

  let bestResult: SerialConfirmation | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of photoUrls) {
    try {
      const result = await confirmSerialVisible(url, expectedSerial);

      // Score: confirmed=10, else confidence + bonus for alternative
      const score = result.confirmed
        ? 10 + result.confidence
        : result.confidence + (result.alternativeSerial ? 2 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      // Stop early if confirmed with high confidence
      if (result.confirmed && result.confidence >= 0.8) {
        log.info('VlmExtraction', `Serial confirmed in ${url.split('/').pop()}`);
        break;
      }
    } catch (error) {
      log.warn('VlmExtraction', `Failed to check ${url}: ${error}`);
    }
  }

  return {
    result: bestResult || {
      confirmed: false,
      confidence: 0,
      expectedSerial,
      visibleText: null,
      alternativeSerial: null,
      details: 'All photo checks failed',
    },
    usedUrl: bestUrl,
  };
}

// ============================================================================
// MULTI-PHOTO EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Try extracting power meter reading from multiple photos, return best result
 */
export async function extractPowerMeterWithMultiplePhotos(
  step7Urls: string[]
): Promise<{ result: PowerMeterExtraction | null; usedUrl: string | null }> {
  if (step7Urls.length === 0) {
    return { result: null, usedUrl: null };
  }

  log.info('VlmExtraction', `Trying ${step7Urls.length} Step 7 photos for power meter extraction`);

  let bestResult: PowerMeterExtraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step7Urls) {
    try {
      const result = await extractPowerMeterReading(url);

      // Score based on success and confidence
      const score = result.success ? 2 + result.confidence : 0;

      log.debug('VlmExtraction', `Step 7 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, value=${result.value}`);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      // Stop early if we got a successful high-confidence extraction
      if (result.success && result.confidence >= 0.9) {
        log.info('VlmExtraction', `Found high-confidence power meter reading, stopping early`);
        break;
      }
    } catch (error) {
      log.warn('VlmExtraction', `Failed to extract power meter from ${url}: ${error}`);
    }
  }

  if (bestResult?.success) {
    log.info('VlmExtraction', `Best Step 7 photo: ${bestUrl?.split('/').pop()}, value=${bestResult.value}`);
  } else {
    log.warn('VlmExtraction', `No successful power meter extraction from ${step7Urls.length} photos`);
  }

  return { result: bestResult, usedUrl: bestUrl };
}

/**
 * Try extracting ONT serial from multiple Step 6 photos, return best result
 */
export async function extractOntSerialWithMultiplePhotos(
  step6Urls: string[]
): Promise<{ result: SerialExtraction | null; usedUrl: string | null }> {
  if (step6Urls.length === 0) {
    return { result: null, usedUrl: null };
  }

  log.info('VlmExtraction', `Trying ${step6Urls.length} Step 6 photos for ONT serial extraction`);

  let bestResult: SerialExtraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step6Urls) {
    try {
      const result = await extractOntSerialFromBack(url);

      // Score based on success and confidence
      const score = result.success ? 2 + result.confidence : 0;

      log.debug('VlmExtraction', `Step 6 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, serial=${result.serial}`);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      // Stop early if we got a successful high-confidence extraction
      if (result.success && result.confidence >= 0.9) {
        log.info('VlmExtraction', `Found high-confidence ONT serial, stopping early`);
        break;
      }
    } catch (error) {
      log.warn('VlmExtraction', `Failed to extract ONT serial from ${url}: ${error}`);
    }
  }

  if (bestResult?.success) {
    log.info('VlmExtraction', `Best Step 6 photo: ${bestUrl?.split('/').pop()}, serial=${bestResult.serial}`);
  } else {
    log.warn('VlmExtraction', `No successful ONT serial extraction from ${step6Urls.length} photos`);
  }

  return { result: bestResult, usedUrl: bestUrl };
}

/**
 * Try extracting Step 9 data from multiple photos, return best result
 * Tries each photo until successful extraction or exhausts all photos
 */
export async function extractStep9WithMultiplePhotos(
  step9Urls: string[]
): Promise<{ result: Step9Extraction | null; usedUrl: string | null }> {
  if (step9Urls.length === 0) {
    return { result: null, usedUrl: null };
  }

  log.info('VlmExtraction', `Trying ${step9Urls.length} Step 9 photos for extraction`);

  let bestResult: Step9Extraction | null = null;
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const url of step9Urls) {
    try {
      const result = await extractStep9Data(url);

      // Calculate score based on what was successfully extracted
      let score = 0;
      if (result.ontSerial.success) score += 2 + result.ontSerial.confidence;
      if (result.drNumber.success) score += 2 + result.drNumber.confidence;
      if (result.greenLightsVisible) score += 1;

      log.debug('VlmExtraction', `Step 9 photo ${url.split('/').pop()}: score=${score.toFixed(2)}, serial=${result.ontSerial.serial}, DR=${result.drNumber.drNumber}`);

      // Keep best result
      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestUrl = url;
      }

      // If we got both serial and DR number with high confidence, stop early
      if (result.ontSerial.success && result.drNumber.success &&
          result.ontSerial.confidence >= 0.8 && result.drNumber.confidence >= 0.8) {
        log.info('VlmExtraction', `Found high-confidence Step 9 result, stopping early`);
        break;
      }
    } catch (error) {
      log.warn('VlmExtraction', `Failed to extract from ${url}: ${error}`);
    }
  }

  if (bestResult) {
    log.info('VlmExtraction', `Best Step 9 photo: ${bestUrl?.split('/').pop()}, score=${bestScore.toFixed(2)}`);
  } else {
    log.warn('VlmExtraction', `No successful Step 9 extraction from ${step9Urls.length} photos`);
  }

  return { result: bestResult, usedUrl: bestUrl };
}

/**
 * Run full extraction for a DR
 *
 * SMART MODE: If expectedOntSerial is provided (from OneMap), uses CONFIRMATION mode
 * which is more accurate than extraction mode. Only falls back to extraction when
 * OneMap doesn't have the serial.
 *
 * @param drNumber - DR number being processed
 * @param photos - Map of step number to photo URL(s) - arrays preferred for better extraction
 * @param options - Optional configuration including expectedOntSerial from OneMap
 */
export async function runFullExtraction(
  drNumber: string,
  photos: {
    step6Url?: string;
    step6Urls?: string[];
    step7Url?: string;
    step7Urls?: string[];
    step9Url?: string;
    step9Urls?: string[];
  },
  options?: {
    /** If OneMap has the ONT serial, provide it here for confirmation mode */
    expectedOntSerial?: string | null;
  }
): Promise<FullExtractionResult> {
  const startTime = Date.now();
  const expectedSerial = options?.expectedOntSerial;
  const useConfirmationMode = !!expectedSerial && isValidOntSerial(expectedSerial);

  log.info('VlmExtraction', `Running ${useConfirmationMode ? 'CONFIRMATION' : 'EXTRACTION'} mode for ${drNumber}${useConfirmationMode ? ` (expecting ${expectedSerial})` : ''}`);

  let powerMeter: PowerMeterExtraction | null = null;
  let ontSerialStep6: SerialExtraction | null = null;
  let step9: Step9Extraction | null = null;
  let serialConfirmation: SerialConfirmation | null = null;

  // Extract power meter from Step 7 - try multiple photos if provided
  if (photos.step7Urls && photos.step7Urls.length > 0) {
    const { result } = await extractPowerMeterWithMultiplePhotos(photos.step7Urls);
    powerMeter = result;
  } else if (photos.step7Url) {
    powerMeter = await extractPowerMeterReading(photos.step7Url);
  }
  if (powerMeter) {
    log.debug('VlmExtraction', `Power meter result: ${powerMeter.success ? powerMeter.value + ' dBm' : 'failed'}`);
  }

  // SMART MODE: Use confirmation when OneMap has serial, otherwise extract
  if (useConfirmationMode && expectedSerial) {
    // ============================================
    // CONFIRMATION MODE: Verify OneMap serial
    // ============================================
    log.info('VlmExtraction', `Using CONFIRMATION mode for ${expectedSerial}`);

    // Combine Step 6 and Step 9 photos for confirmation
    const allSerialPhotos = [
      ...(photos.step6Urls || []),
      ...(photos.step6Url ? [photos.step6Url] : []),
      ...(photos.step9Urls || []),
      ...(photos.step9Url ? [photos.step9Url] : []),
    ];

    if (allSerialPhotos.length > 0) {
      const { result } = await confirmSerialFromMultiplePhotos(allSerialPhotos, expectedSerial);
      serialConfirmation = result;

      if (serialConfirmation.confirmed) {
        log.info('VlmExtraction', `✓ Serial ${expectedSerial} CONFIRMED in photos`);

        // Create synthetic extraction result from confirmation
        ontSerialStep6 = {
          success: true,
          serial: expectedSerial,
          confidence: serialConfirmation.confidence,
          location: 'back',
          rawText: serialConfirmation.visibleText || expectedSerial,
          extractionMethod: 'vlm',
        };
      } else {
        log.warn('VlmExtraction', `✗ Serial ${expectedSerial} NOT confirmed - ${serialConfirmation.details}`);

        // If we found a different serial, report it
        if (serialConfirmation.alternativeSerial) {
          log.warn('VlmExtraction', `Found alternative serial: ${serialConfirmation.alternativeSerial}`);
          ontSerialStep6 = {
            success: true,
            serial: serialConfirmation.alternativeSerial,
            confidence: serialConfirmation.confidence,
            location: 'back',
            rawText: serialConfirmation.visibleText || serialConfirmation.alternativeSerial,
            extractionMethod: 'vlm',
          };
        } else {
          // Couldn't confirm or find alternative - fall back to extraction
          log.info('VlmExtraction', 'Falling back to extraction mode');
          if (photos.step6Urls && photos.step6Urls.length > 0) {
            const { result } = await extractOntSerialWithMultiplePhotos(photos.step6Urls);
            ontSerialStep6 = result;
          } else if (photos.step6Url) {
            ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
          }
        }
      }
    }

    // Still extract Step 9 for DR number and green lights
    if (photos.step9Urls && photos.step9Urls.length > 0) {
      const { result } = await extractStep9WithMultiplePhotos(photos.step9Urls);
      step9 = result;
    } else if (photos.step9Url) {
      step9 = await extractStep9Data(photos.step9Url);
    }
  } else {
    // ============================================
    // EXTRACTION MODE: No OneMap serial, extract from photos
    // ============================================
    log.info('VlmExtraction', 'Using EXTRACTION mode (no OneMap serial)');

    // Extract ONT serial from Step 6 (back) - try multiple photos if provided
    if (photos.step6Urls && photos.step6Urls.length > 0) {
      const { result } = await extractOntSerialWithMultiplePhotos(photos.step6Urls);
      ontSerialStep6 = result;
    } else if (photos.step6Url) {
      ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
    }

    // Extract Step 9 data - try multiple photos if provided
    if (photos.step9Urls && photos.step9Urls.length > 0) {
      const { result } = await extractStep9WithMultiplePhotos(photos.step9Urls);
      step9 = result;
    } else if (photos.step9Url) {
      step9 = await extractStep9Data(photos.step9Url);
    }
  }

  if (ontSerialStep6) {
    log.debug('VlmExtraction', `ONT serial Step 6: ${ontSerialStep6.success ? ontSerialStep6.serial : 'failed'}`);
  }
  if (step9) {
    log.debug('VlmExtraction', `Step 9: serial=${step9.ontSerial.serial}, DR=${step9.drNumber.drNumber}`);
  }

  const totalProcessingTimeMs = Date.now() - startTime;

  log.info('VlmExtraction', `Full extraction complete for ${drNumber} in ${totalProcessingTimeMs}ms (mode: ${useConfirmationMode ? 'confirm' : 'extract'})`);

  return {
    drNumber,
    powerMeter,
    ontSerialStep6,
    step9,
    serialConfirmation,
    usedConfirmationMode: useConfirmationMode,
    totalProcessingTimeMs,
  };
}

/**
 * Compare two serials for match (case-insensitive, trim whitespace)
 */
export function serialsMatch(serial1: string | null, serial2: string | null): boolean {
  if (!serial1 || !serial2) return false;
  return serial1.trim().toUpperCase() === serial2.trim().toUpperCase();
}

/**
 * Check if DR numbers match (handles prefix variations)
 */
export function drNumbersMatch(extracted: string | null, expected: string): boolean {
  if (!extracted) return false;

  // Normalize both: remove "DR" prefix, spaces, and compare
  const normalizedr = (s: string) =>
    s
      .replace(/^DR/i, '')
      .replace(/\s+/g, '')
      .toUpperCase();

  return normalizedr(extracted) === normalizedr(expected);
}

// ============================================================================
// WA PHOTO SERIAL EXTRACTION
// ============================================================================

/**
 * Result from WA photo serial extraction
 */
export interface WaPhotoExtractionResult {
  success: boolean;
  ontSerial: string | null;
  upsSerial: string | null;
  confidence: number;
  processingTimeMs: number;
  error?: string;
}

/**
 * Prompt for extracting ONT and UPS serials from WA photo sticker
 * WA photos typically show a printed sticker with both serials clearly visible
 */
const WA_PHOTO_SERIAL_PROMPT = `You are extracting device serial numbers from a WhatsApp-submitted installation photo.

This photo shows a printed sticker with TWO serial numbers that need to be captured:

1. ONT SERIAL NUMBER:
   - Starts with "ALCL" or "ALCB" followed by 7-8 alphanumeric characters
   - Usually labeled "S/N:" or "ONT Serial"
   - 11-12 characters total
   ❌ Do NOT extract SSID values (start with "ALHN-" like ALHN-C397)

2. UPS SERIAL NUMBER:
   - Starts with "GU18W" followed by 8-10 alphanumeric characters
   - Usually labeled "UPS Serial" or "Gizzu Serial"
   - 13-15 characters total

Both serials should be on the same sticker/label.
Read the ACTUAL text from the photo. Do NOT guess or invent serial numbers.

Respond in this exact JSON format:
{
  "ontSerial": {
    "found": true/false,
    "serial": "<serial starting with ALCL or ALCB, or null>",
    "confidence": <0.0 to 1.0>
  },
  "upsSerial": {
    "found": true/false,
    "serial": "<serial starting with GU18W, or null>",
    "confidence": <0.0 to 1.0>
  }
}

IMPORTANT:
- Only extract serials you can ACTUALLY READ in the photo
- If text is blurry or partially visible, lower the confidence score
- Return null for any serial you cannot confidently read
- NEVER return a serial you are not sure about - null is better than wrong`;

/**
 * Serials used as examples in VLM prompts — if the model returns
 * one of these exactly it is regurgitating the prompt, not reading
 * the photo.  Normalised to uppercase, stripped of whitespace/dashes.
 */
const PROMPT_EXAMPLE_SERIALS = new Set([
  'ALCLB6A9C97',
  'ALCLB48CC3CA',
  'GU18W220901234',
]);

/** Minimum confidence we accept from VLM serial extraction */
const VLM_CONFIDENCE_FLOOR = 0.65;

/**
 * Returns true if the serial is a known prompt example (hallucination).
 */
function isPromptExampleSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase().replace(/[\s-]/g, '');
  if (PROMPT_EXAMPLE_SERIALS.has(s)) {
    log.warn('VlmExtraction', `Rejected prompt-example hallucination: ${serial}`);
    return true;
  }
  return false;
}

/**
 * Validate UPS/Gizzu serial format
 * - Must start with GU18W
 * - Must be 13-15 characters
 * - Must not be a prompt example (hallucination guard)
 */
function isValidUpsSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();

  // Hallucination guard — reject prompt examples
  if (isPromptExampleSerial(s)) return false;

  // Must start with GU18W (Gizzu UPS pattern)
  if (!s.startsWith('GU18W')) {
    log.debug('VlmExtraction', `Rejected non-GU18W UPS serial: ${serial}`);
    return false;
  }

  // Should be 13-15 chars
  if (s.length < 12 || s.length > 16) {
    log.debug('VlmExtraction', `Rejected UPS serial with wrong length (${s.length}): ${serial}`);
    return false;
  }

  return true;
}

/**
 * Extract ONT and UPS serials from a WhatsApp photo
 * WA photos typically show a sticker with both serials clearly visible
 *
 * @param photoUrl - URL or local path to the WA photo
 * @returns Extraction result with both serials
 */
export async function extractSerialsFromWaPhoto(photoUrl: string): Promise<WaPhotoExtractionResult> {
  const startTime = Date.now();
  log.info('VlmExtraction', `Extracting serials from WA photo: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    // Preprocess image (blur detection + optimization)
    const preprocessed = await preprocessForVlm(base64, 'WA photo serial');
    base64 = preprocessed.base64;

    // Try barcode extraction first for ONT (faster, more reliable)
    let ontFromBarcode: string | null = null;
    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        const barcodeResult = await extractOntSerialFromBarcode(base64);
        if (barcodeResult.success && barcodeResult.serial) {
          log.info('VlmExtraction', `WA photo barcode scan: ${barcodeResult.serial}`);
          ontFromBarcode = barcodeResult.serial;
        }
      } catch (barcodeError) {
        log.warn('VlmExtraction', `WA photo barcode scan failed: ${barcodeError}`);
      }
    }

    // Call VLM for both serials (or just UPS if barcode got ONT)
    const result = await callVlmExtraction<{
      ontSerial: {
        found: boolean;
        serial: string | null;
        confidence: number;
      };
      upsSerial: {
        found: boolean;
        serial: string | null;
        confidence: number;
      };
    }>(base64, WA_PHOTO_SERIAL_PROMPT, 'WA photo serial extraction');

    const processingTimeMs = Date.now() - startTime;

    if (!result.success || !result.data) {
      return {
        success: false,
        ontSerial: ontFromBarcode,
        upsSerial: null,
        confidence: ontFromBarcode ? 0.95 : 0,
        processingTimeMs,
        error: result.error || 'VLM extraction failed',
      };
    }

    const { ontSerial: ontResult, upsSerial: upsResult } = result.data;

    // Use barcode ONT if available (higher reliability), otherwise VLM
    let finalOnt: string | null = null;
    let ontConfidence = 0;
    if (ontFromBarcode) {
      finalOnt = ontFromBarcode;
      ontConfidence = 0.98; // Barcode is highly reliable
    } else if (ontResult.found && ontResult.serial) {
      if (ontResult.confidence < VLM_CONFIDENCE_FLOOR) {
        log.warn('VlmExtraction', `WA photo ONT below confidence floor (${ontResult.confidence.toFixed(2)} < ${VLM_CONFIDENCE_FLOOR}): ${ontResult.serial}`);
      } else {
        const normalized = normalizeSerial(ontResult.serial);
        if (isValidOntSerial(normalized)) {
          finalOnt = normalized;
          ontConfidence = ontResult.confidence;
        } else {
          log.warn('VlmExtraction', `WA photo VLM returned invalid ONT: ${ontResult.serial}`);
        }
      }
    }

    // Validate UPS serial
    let finalUps: string | null = null;
    let upsConfidence = 0;
    if (upsResult.found && upsResult.serial) {
      if (upsResult.confidence < VLM_CONFIDENCE_FLOOR) {
        log.warn('VlmExtraction', `WA photo UPS below confidence floor (${upsResult.confidence.toFixed(2)} < ${VLM_CONFIDENCE_FLOOR}): ${upsResult.serial}`);
      } else {
        const normalized = upsResult.serial.trim().toUpperCase().replace(/[\s-]/g, '');
        if (isValidUpsSerial(normalized)) {
          finalUps = normalized;
          upsConfidence = upsResult.confidence;
        } else {
          log.warn('VlmExtraction', `WA photo VLM returned invalid UPS: ${upsResult.serial}`);
        }
      }
    }

    // Calculate overall confidence
    const overallConfidence = Math.max(ontConfidence, upsConfidence);
    const success = !!finalOnt || !!finalUps;

    log.info('VlmExtraction', `WA photo extraction: ONT=${finalOnt || 'none'} (${ontConfidence.toFixed(2)}), UPS=${finalUps || 'none'} (${upsConfidence.toFixed(2)})`);

    return {
      success,
      ontSerial: finalOnt,
      upsSerial: finalUps,
      confidence: overallConfidence,
      processingTimeMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('VlmExtraction', `WA photo extraction failed: ${message}`);

    return {
      success: false,
      ontSerial: null,
      upsSerial: null,
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
      error: message,
    };
  }
}
