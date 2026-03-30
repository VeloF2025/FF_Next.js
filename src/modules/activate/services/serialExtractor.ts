/**
 * Serial Extractor
 *
 * Purpose: ONT serial validation helpers, hallucination guards, normalization,
 * and Step 6 (back of ONT) extraction with barcode-first approach.
 *
 * Step 9 and multi-photo confirmation logic lives in step9Extractor.ts.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { fetchPhotoAsBase64 } from './photoFetchService';
import { extractOntSerialFromBarcode } from './barcodeExtractionService';
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
  ENABLE_BARCODE_EXTRACTION,
  type SerialExtraction,
  type SerialConfirmation,
  type DrNumberExtraction,
  type Step9Extraction,
} from './vlmClient';
import { ONT_SERIAL_BACK_PROMPT } from './vlmPrompts';

// Re-export these types so callers importing from serialExtractor still work
export type { SerialExtraction, SerialConfirmation, DrNumberExtraction, Step9Extraction };

// ============================================================================
// HALLUCINATION GUARD
// ============================================================================

/**
 * Serials used as examples in VLM prompts — if the model returns one of these
 * exactly it is regurgitating the prompt, not reading the photo.
 */
const PROMPT_EXAMPLE_SERIALS = new Set([
  'ALCLB6A9C97',
  'ALCLB48CC3CA',
  'ALCLB48F2939',
  'ALCL12345678',
  'ALCLM1234567',
  'ALCL8400821',
  'ALCL6400821',
  'ALCL8408021',
  'ALCL84080311',
  'GU18W220901234',
  // Ghost/sticky serials: appear repeatedly in Step 6/9 mismatches
  'ALCLB48D2939', // ghost serial — 37% of Step 6 errors
  'ALCLB48DF36C', // sticky serial — Step 9
  'ALCLB48DE198', // sticky serial — Step 9
  'ALCLB48E0939', // variant of ghost serial
  'ALCLB48E2939', // variant of ghost serial
  'ALCLB48D0A4F', // sticky serial — Step 9
]);

/**
 * Returns true if the serial is a known prompt example (hallucination).
 */
export function isPromptExampleSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase().replace(/[\s-]/g, '');
  if (PROMPT_EXAMPLE_SERIALS.has(s)) {
    vlmLogger.warn(`Rejected prompt-example hallucination: ${serial}`);
    return true;
  }
  return false;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate ONT serial format.
 * - Must start with ALCLB4
 * - Must be exactly 12 characters
 * - Must NOT be an SSID (ALHN-*) or prompt example
 */
export function isValidOntSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();

  if (isPromptExampleSerial(s)) return false;

  if (s.startsWith('ALHN') || s.startsWith('ALH-') || s.includes('-')) {
    vlmLogger.debug(`Rejected SSID-like value: ${serial}`);
    return false;
  }

  if (!s.startsWith('ALCLB4')) {
    vlmLogger.debug(`Rejected non-ALCLB4 serial: ${serial}`);
    return false;
  }

  if (s.length !== 12) {
    vlmLogger.debug(`Rejected serial with wrong length (${s.length}): ${serial}`);
    return false;
  }

  const suffix = s.substring(6);
  if (!/^[0-9A-F]{6}$/.test(suffix)) {
    vlmLogger.debug(`Rejected serial with non-hex suffix: ${serial}`);
    return false;
  }

  return true;
}

/**
 * Clean and normalize an extracted serial.
 * Fixes common VLM extraction errors based on OES ground truth analysis.
 */
export function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  let s = serial.trim().toUpperCase();

  s = s.replace(/[\s\-,]/g, '');
  s = s.replace(/\./g, '');

  if (s.startsWith('ALCLB4') && s.length >= 7) {
    const prefix = s.substring(0, 6);
    let suffix = s.substring(6);
    suffix = suffix.replace(/[GI]/g, '6');
    suffix = suffix.replace(/[O]/g, '0');
    suffix = suffix.replace(/[S]/g, '5');
    suffix = suffix.replace(/[Z]/g, '2');
    // Additional OCR corrections based on character confusion analysis
    suffix = suffix.replace(/[L]/g, '1'); // L looks like 1 in small sticker text
    suffix = suffix.replace(/[T]/g, '7'); // T misread as hex 7
    suffix = suffix.replace(/[J]/g, '1'); // J looks like 1
    suffix = suffix.replace(/[^0-9A-F]/g, '');
    s = prefix + suffix;
  }

  // Auto-fix: 11-char serials — try inserting missing 7th char
  if (s.length === 11 && s.startsWith('ALCLB4')) {
    const c7 = s[6];
    if (c7 !== '8' && c7 !== '7' && c7 !== '6') {
      const candidate = s.substring(0, 6) + '8' + s.substring(6);
      vlmLogger.debug(`Auto-inserted '8' at pos 7: ${serial} → ${candidate}`);
      s = candidate;
    }
  }

  return s;
}

// ============================================================================
// STEP 6 EXTRACTION
// ============================================================================

/**
 * Extract ONT serial from Step 6 photo (back of ONT) using VLM only.
 * Internal — call extractOntSerialFromBack for the barcode-first approach.
 */
export async function extractOntSerialFromBackViaVlm(
  base64: string
): Promise<SerialExtraction> {
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
      vlmLogger.debug(`Injected ${examples.length} few-shot examples for ONT serial`);
    }
  } catch (fewShotError) {
    vlmLogger.warn(`Few-shot retrieval failed: ${fewShotError}`);
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
  const normalizedSerial = normalizeSerial(serial);
  const isValid = isValidOntSerial(normalizedSerial);

  if (found && serial && !isValid) {
    vlmLogger.warn(`VLM returned invalid serial "${serial}" (likely SSID or wrong field)`);
  }

  if (found && isValid && confidence >= 0.7) {
    recordCorrectExtraction('activate', 'ont_serial_back', confidence).catch(() => {});
  }

  return {
    success: found && isValid,
    serial: isValid ? normalizedSerial : null,
    confidence: isValid ? confidence || 0 : 0,
    location: 'back',
    rawText: rawText || null,
    error: found && !isValid ? `Invalid serial format: ${serial}` : undefined,
    extractionMethod: 'vlm',
  };
}

/**
 * Extract ONT serial from Step 6 photo (back of ONT).
 * Uses barcode scanning first, falls back to VLM if no barcode found.
 *
 * @param photoUrl - URL of the Step 6 photo
 * @returns Serial extraction result
 */
export async function extractOntSerialFromBack(
  photoUrl: string
): Promise<SerialExtraction> {
  vlmLogger.debug(`Extracting ONT serial from back: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);
    const preprocessed = await preprocessForVlm(base64, 'Step 6 ONT serial');
    base64 = preprocessed.base64;

    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        vlmLogger.debug('Attempting barcode scan for ONT serial');
        const barcodeResult = await extractOntSerialFromBarcode(base64);

        if (barcodeResult.success && barcodeResult.serial) {
          vlmLogger.info(`Barcode scan successful: ${barcodeResult.serial} (${barcodeResult.format})`);
          return {
            success: true,
            serial: barcodeResult.serial,
            confidence: barcodeResult.confidence,
            location: 'back',
            rawText: `Barcode (${barcodeResult.format}): ${barcodeResult.serial}`,
            extractionMethod: 'barcode',
          };
        }
        vlmLogger.debug('No barcode found, falling back to VLM');
      } catch (barcodeError) {
        vlmLogger.warn(`Barcode scan error: ${barcodeError}, falling back to VLM`);
      }
    }

    return extractOntSerialFromBackViaVlm(base64);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`ONT serial back extraction failed: ${message}`, undefined, 'VlmExtraction');

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

// ============================================================================
// UTILITY HELPERS
// ============================================================================

/**
 * Compare two serials for match (case-insensitive, trim whitespace).
 */
export function serialsMatch(
  serial1: string | null,
  serial2: string | null
): boolean {
  if (!serial1 || !serial2) return false;
  return serial1.trim().toUpperCase() === serial2.trim().toUpperCase();
}

/**
 * Check if DR numbers match (handles prefix variations).
 */
export function drNumbersMatch(
  extracted: string | null,
  expected: string
): boolean {
  if (!extracted) return false;
  const normalizedr = (s: string) =>
    s.replace(/^DR/i, '').replace(/\s+/g, '').toUpperCase();
  return normalizedr(extracted) === normalizedr(expected);
}
