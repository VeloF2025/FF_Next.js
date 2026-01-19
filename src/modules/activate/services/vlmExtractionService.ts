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

// Feature flag for barcode extraction
const ENABLE_BARCODE_EXTRACTION = process.env.ENABLE_BARCODE_EXTRACTION !== 'false'; // Enabled by default

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
   - Starts with "ALCL" or "ALCB" (e.g., ALCLB6A9C97, ALCLB48CC3CA)
   - Exactly 11-12 alphanumeric characters
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

Respond in this exact JSON format:
{
  "found": true/false,
  "serial": "<serial starting with ALCL or ALCB, or null>",
  "rawText": "<exact text you read from the S/N field>",
  "confidence": <0.0 to 1.0>
}

IMPORTANT: If you cannot find a field starting with ALCL or ALCB, set found to false.
Do NOT return SSID values (ALHN-*) as the serial.`;

/**
 * Prompt for Step 9 front panel extraction (ONT serial + DR number)
 */
const STEP9_FRONT_PROMPT = `You are analyzing the front of a Nokia/Alcatel ONT device with installation labels.

Look for these items:
1. GREEN STATUS LIGHTS - Are the indicator LEDs illuminated (green)?
2. ONT SERIAL - A label showing serial starting with "ALCL" or "ALCB" (11-12 chars)
3. DR NUMBER - A black-on-yellow label with "DR" followed by 6-7 digits (e.g., DR1736721)

Respond in this exact JSON format:
{
  "greenLightsVisible": true/false,
  "ontSerial": {
    "found": true/false,
    "serial": "<serial or null>",
    "rawText": "<text from label>",
    "confidence": <0.0 to 1.0>
  },
  "drNumber": {
    "found": true/false,
    "drNumber": "<DR number or null>",
    "rawText": "<text from label>",
    "confidence": <0.0 to 1.0>
  }
}

Extract only what you can clearly read. Do not guess partial text.`;

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
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract power meter reading from Step 7 photo
 */
export async function extractPowerMeterReading(photoUrl: string): Promise<PowerMeterExtraction> {
  log.debug('VlmExtraction', `Extracting power meter reading from ${photoUrl}`);

  try {
    const base64 = await fetchPhotoAsBase64(photoUrl);

    const result = await callVlmExtraction<{
      found: boolean;
      value: number | null;
      rawText: string | null;
      confidence: number;
    }>(base64, POWER_METER_PROMPT, 'Power meter extraction');

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
 * (Internal function - use extractOntSerialFromBack for barcode-first approach)
 */
async function extractOntSerialFromBackViaVlm(base64: string): Promise<SerialExtraction> {
  const result = await callVlmExtraction<{
    found: boolean;
    serial: string | null;
    rawText: string | null;
    confidence: number;
  }>(base64, ONT_SERIAL_BACK_PROMPT, 'ONT serial back extraction');

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

  return {
    success: found && !!serial,
    serial: found ? serial : null,
    confidence: confidence || 0,
    location: 'back',
    rawText: rawText || null,
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
    const base64 = await fetchPhotoAsBase64(photoUrl);

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

    // Step 2: Fall back to VLM extraction
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
    const base64 = await fetchPhotoAsBase64(photoUrl);

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

    // Use barcode serial if available (higher reliability), otherwise VLM
    const finalOntSerial: SerialExtraction = barcodeSerial || {
      success: ontSerial.found && !!ontSerial.serial,
      serial: ontSerial.found ? ontSerial.serial : null,
      confidence: ontSerial.confidence || 0,
      location: 'front_label',
      rawText: ontSerial.rawText || null,
      extractionMethod: 'vlm',
    };

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
      let score = result.success ? 2 + result.confidence : 0;

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
      let score = result.success ? 2 + result.confidence : 0;

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
 * @param drNumber - DR number being processed
 * @param photos - Map of step number to photo URL(s) - arrays preferred for better extraction
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
  }
): Promise<FullExtractionResult> {
  const startTime = Date.now();
  log.info('VlmExtraction', `Running full extraction for ${drNumber}`);

  let powerMeter: PowerMeterExtraction | null = null;
  let ontSerialStep6: SerialExtraction | null = null;
  let step9: Step9Extraction | null = null;

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

  // Extract ONT serial from Step 6 (back) - try multiple photos if provided
  if (photos.step6Urls && photos.step6Urls.length > 0) {
    const { result } = await extractOntSerialWithMultiplePhotos(photos.step6Urls);
    ontSerialStep6 = result;
  } else if (photos.step6Url) {
    ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
  }
  if (ontSerialStep6) {
    log.debug('VlmExtraction', `ONT serial Step 6: ${ontSerialStep6.success ? ontSerialStep6.serial : 'failed'}`);
  }

  // Extract Step 9 data - try multiple photos if provided
  if (photos.step9Urls && photos.step9Urls.length > 0) {
    const { result } = await extractStep9WithMultiplePhotos(photos.step9Urls);
    step9 = result;
  } else if (photos.step9Url) {
    step9 = await extractStep9Data(photos.step9Url);
  }
  if (step9) {
    log.debug('VlmExtraction', `Step 9: serial=${step9.ontSerial.serial}, DR=${step9.drNumber.drNumber}`);
  }

  const totalProcessingTimeMs = Date.now() - startTime;

  log.info('VlmExtraction', `Full extraction complete for ${drNumber} in ${totalProcessingTimeMs}ms`);

  return {
    drNumber,
    powerMeter,
    ontSerialStep6,
    step9,
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
