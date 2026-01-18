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
 */
const ONT_SERIAL_BACK_PROMPT = `You are extracting the ONT (Optical Network Terminal) serial number from the back of the device.

Look for a serial number label on the back panel. Nokia/Alcatel ONT serials typically:
- Start with "ALCL" or "ALCB"
- Are 11-12 characters long
- Contain letters and numbers

Respond in this exact JSON format:
{
  "found": true/false,
  "serial": "<serial number or null>",
  "rawText": "<exact text from label>",
  "confidence": <0.0 to 1.0>
}

If you find multiple serials, extract the one starting with ALCL or ALCB.
Only extract what you can clearly read.`;

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
 * Extract ONT serial from Step 6 photo (back of ONT)
 */
export async function extractOntSerialFromBack(photoUrl: string): Promise<SerialExtraction> {
  log.debug('VlmExtraction', `Extracting ONT serial from back: ${photoUrl}`);

  try {
    const base64 = await fetchPhotoAsBase64(photoUrl);

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
      };
    }

    const { found, serial, rawText, confidence } = result.data;

    return {
      success: found && !!serial,
      serial: found ? serial : null,
      confidence: confidence || 0,
      location: 'back',
      rawText: rawText || null,
    };
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
    };
  }
}

/**
 * Extract data from Step 9 photo (front of ONT with labels)
 */
export async function extractStep9Data(photoUrl: string): Promise<Step9Extraction> {
  const startTime = Date.now();
  log.debug('VlmExtraction', `Extracting Step 9 data from: ${photoUrl}`);

  try {
    const base64 = await fetchPhotoAsBase64(photoUrl);

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
      return {
        ontSerial: {
          success: false,
          serial: null,
          confidence: 0,
          location: 'front_label',
          rawText: null,
          error: result.error,
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

    return {
      ontSerial: {
        success: ontSerial.found && !!ontSerial.serial,
        serial: ontSerial.found ? ontSerial.serial : null,
        confidence: ontSerial.confidence || 0,
        location: 'front_label',
        rawText: ontSerial.rawText || null,
      },
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
 * Run full extraction for a DR
 *
 * @param drNumber - DR number being processed
 * @param photos - Map of step number to photo URL
 */
export async function runFullExtraction(
  drNumber: string,
  photos: { step6Url?: string; step7Url?: string; step9Url?: string }
): Promise<FullExtractionResult> {
  const startTime = Date.now();
  log.info('VlmExtraction', `Running full extraction for ${drNumber}`);

  let powerMeter: PowerMeterExtraction | null = null;
  let ontSerialStep6: SerialExtraction | null = null;
  let step9: Step9Extraction | null = null;

  // Extract power meter from Step 7
  if (photos.step7Url) {
    powerMeter = await extractPowerMeterReading(photos.step7Url);
    log.debug('VlmExtraction', `Power meter result: ${powerMeter.success ? powerMeter.value + ' dBm' : 'failed'}`);
  }

  // Extract ONT serial from Step 6 (back)
  if (photos.step6Url) {
    ontSerialStep6 = await extractOntSerialFromBack(photos.step6Url);
    log.debug('VlmExtraction', `ONT serial Step 6: ${ontSerialStep6.success ? ontSerialStep6.serial : 'failed'}`);
  }

  // Extract Step 9 data (front: serial + DR number)
  if (photos.step9Url) {
    step9 = await extractStep9Data(photos.step9Url);
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
