/**
 * WhatsApp Photo Serial Extraction
 *
 * Purpose: Extract ONT and UPS/Gizzu serials from WhatsApp-submitted
 * installation sticker photos. Uses barcode-first for ONT, VLM for UPS.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { fetchPhotoAsBase64 } from './photoFetchService';
import { extractOntSerialFromBarcode } from './barcodeExtractionService';
import { log } from '@/lib/logger';
import {
  vlmLogger,
  callVlmExtraction,
  preprocessForVlm,
  ENABLE_BARCODE_EXTRACTION,
} from './vlmClient';
import {
  isValidOntSerial,
  normalizeSerial,
  isPromptExampleSerial,
} from './serialExtractor';
import { getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from WA photo serial extraction
 */
export interface WaPhotoExtractionResult {
  success: boolean;
  ontSerial: string | null;
  upsSerial: string | null;
  confidence: number;
  ontConfidence: number;
  upsConfidence: number;
  processingTimeMs: number;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum confidence we accept from VLM serial extraction */
const VLM_CONFIDENCE_FLOOR = 0.65;

// ============================================================================
// PROMPT
// ============================================================================

const WA_PHOTO_SERIAL_PROMPT = `You are extracting device serial numbers from a WhatsApp-submitted installation photo.

This photo shows a printed sticker with TWO serial numbers:

1. ONT SERIAL NUMBER:
   FORMAT: ALCLB4 + 6 hex characters = exactly 12 characters
   - The 7th char is "8" (64%), "7" (26%), or "6" (10%) — read carefully, don't assume
   - Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB48F (6%)
   - Only hex chars (0-9, A-F) after the ALCLB4 prefix
   - NEVER letters M, N, P, R, S, Y, Z — those mean you misread
   - Usually labeled "S/N:" or "ONT Serial"
   ❌ Do NOT extract SSID values (start with "ALHN-")
   ❌ Do NOT extract model/part numbers (start with "STN")

2. UPS SERIAL NUMBER:
   - Full model+serial string printed BELOW the barcode on the Gizzu UPS sticker
   - Format: "GU18W12V" (model prefix) + 10 numeric digits = EXACTLY 18 characters total
   - Example shape: GU18W12V##########
   - IMPORTANT: Read the ENTIRE string — do NOT drop "12V" from the middle
   - ⚠️ The small "GU18W12V" text ABOVE the barcode is the MODEL CODE, NOT the serial.
     The REAL serial is the long string printed BELOW the barcode (starts with GU18W12V + 10 digits).
   - ⚠️ The UPS sticker is OFTEN ROTATED (upside down or sideways) — rotate text mentally before reading
   - ⚠️ If you cannot clearly read the 10 digits after GU18W12V, return found:false.
     NEVER pad with zeros, NEVER invent placeholder digits, NEVER return GU18W12V0000000000.
     A null answer is MUCH better than a wrong serial.
   - The barcode itself encodes the SAME serial — cross-check if possible

⚠️ VALIDATION (check before answering):
- ONT serial must be exactly 12 chars starting with ALCLB4
- If you read 11 chars, you likely dropped a char at position 7
- If chars after ALCLB4 include M/N/P/R/Y, re-read — those aren't hex

Respond in this exact JSON format:
{
  "ontSerial": {
    "found": true/false,
    "serial": "<12-char serial starting with ALCLB4, or null>",
    "confidence": <0.0 to 1.0>
  },
  "upsSerial": {
    "found": true/false,
    "serial": "<full serial starting with GU18W12V, or null>",
    "confidence": <0.0 to 1.0>
  }
}

CRITICAL: Only extract serials you can ACTUALLY READ. null is better than wrong.`;

// ============================================================================
// UPS VALIDATION
// ============================================================================

/** Known UPS hallucination values the VLM tends to emit when it can't read digits */
const UPS_HALLUCINATION_BLOCKLIST = new Set<string>([
  'GU18W12V0000000000',
  'GU18W12V1111111111',
  'GU18W12V1234567890',
  'GU18W12V25-0030103',
  'GU18W12V25-04C30103',
]);

/**
 * Validate UPS/Gizzu serial format.
 * - Must start with GU18W
 * - Must be 18–22 characters (GU18W12V + 10 digits = 18 typical)
 * - Must not be a prompt example or known hallucination (zero-padding, repeated digits)
 */
function isValidUpsSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();

  if (isPromptExampleSerial(s)) return false;

  if (!s.startsWith('GU18W')) {
    vlmLogger.debug(`Rejected non-GU18W UPS serial: ${serial}`);
    return false;
  }

  if (s.length < 18 || s.length > 22) {
    vlmLogger.debug(
      `Rejected UPS serial with wrong length (${s.length}): ${serial}`
    );
    return false;
  }

  if (UPS_HALLUCINATION_BLOCKLIST.has(s)) {
    vlmLogger.warn(`Rejected UPS hallucination (blocklist): ${serial}`);
    return false;
  }

  // Suffix anti-hallucination: reject all-zero, all-same-digit, or mostly-zero
  // suffixes after the GU18W12V prefix. Real Gizzu serials are high-entropy.
  const suffix = s.startsWith('GU18W12V') ? s.slice(8) : '';
  if (suffix.length >= 10) {
    const digits = suffix.slice(0, 10);
    if (/^(\d)\1{9}$/.test(digits)) {
      vlmLogger.warn(`Rejected UPS hallucination (repeated digit): ${serial}`);
      return false;
    }
    const zeroCount = (digits.match(/0/g) || []).length;
    if (zeroCount >= 7) {
      vlmLogger.warn(
        `Rejected UPS hallucination (${zeroCount}/10 zeros): ${serial}`
      );
      return false;
    }
  }

  return true;
}

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Extract ONT and UPS serials from a WhatsApp photo.
 * WA photos typically show a sticker with both serials clearly visible.
 * Uses barcode-first for ONT, VLM OCR for UPS.
 *
 * @param photoUrl - URL or local path to the WA photo
 * @returns Extraction result with both serials
 */
export async function extractSerialsFromWaPhoto(
  photoUrl: string
): Promise<WaPhotoExtractionResult> {
  const startTime = Date.now();
  vlmLogger.info(`Extracting serials from WA photo: ${photoUrl}`);

  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);

    const preprocessed = await preprocessForVlm(base64, 'WA photo serial');
    base64 = preprocessed.base64;

    // Try barcode extraction first for ONT (faster, more reliable)
    let ontFromBarcode: string | null = null;
    if (ENABLE_BARCODE_EXTRACTION) {
      try {
        const barcodeResult = await extractOntSerialFromBarcode(base64);
        if (barcodeResult.success && barcodeResult.serial) {
          vlmLogger.info(`WA photo barcode scan: ${barcodeResult.serial}`);
          ontFromBarcode = barcodeResult.serial;
        }
      } catch (barcodeError) {
        vlmLogger.warn(`WA photo barcode scan failed: ${barcodeError}`);
      }
    }

    // Inject HITL few-shot examples from past corrections (non-blocking on failure)
    let waPhotoPrompt = WA_PHOTO_SERIAL_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'activate',
        analysisType: 'wa_photo_serial',
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      const fewShotSection = buildVlmFewShotPrompt(examples);
      if (fewShotSection) {
        waPhotoPrompt = `${fewShotSection}\n\n${WA_PHOTO_SERIAL_PROMPT}`;
        vlmLogger.info(`Injecting ${examples.length} few-shot examples for wa_photo_serial`);
      }
    } catch (fewShotError) {
      vlmLogger.warn(`Few-shot retrieval failed (continuing without): ${fewShotError}`);
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
    }>(base64, waPhotoPrompt, 'WA photo serial extraction');

    const processingTimeMs = Date.now() - startTime;

    if (!result.success || !result.data) {
      return {
        success: false,
        ontSerial: ontFromBarcode,
        upsSerial: null,
        confidence: ontFromBarcode ? 0.95 : 0,
        ontConfidence: ontFromBarcode ? 0.95 : 0,
        upsConfidence: 0,
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
        vlmLogger.warn(
          `WA photo ONT below confidence floor (${ontResult.confidence.toFixed(2)} < ${VLM_CONFIDENCE_FLOOR}): ${ontResult.serial}`
        );
      } else {
        const normalized = normalizeSerial(ontResult.serial);
        if (isValidOntSerial(normalized)) {
          finalOnt = normalized;
          ontConfidence = ontResult.confidence;
        } else {
          vlmLogger.warn(
            `WA photo VLM returned invalid ONT: ${ontResult.serial}`
          );
        }
      }
    }

    // Validate UPS serial
    let finalUps: string | null = null;
    let upsConfidence = 0;
    if (upsResult.found && upsResult.serial) {
      if (upsResult.confidence < VLM_CONFIDENCE_FLOOR) {
        vlmLogger.warn(
          `WA photo UPS below confidence floor (${upsResult.confidence.toFixed(2)} < ${VLM_CONFIDENCE_FLOOR}): ${upsResult.serial}`
        );
      } else {
        const normalized = upsResult.serial
          .trim()
          .toUpperCase()
          .replace(/[\s-]/g, '');
        if (isValidUpsSerial(normalized)) {
          finalUps = normalized;
          upsConfidence = upsResult.confidence;
        } else {
          vlmLogger.warn(
            `WA photo VLM returned invalid UPS: ${upsResult.serial} (${normalized.length} chars)`
          );
        }
      }
    }

    // Retry UPS with rotations if initial read failed. The Gizzu sticker is
    // often upside down (180°) or sideways (90°/270°) on the shipping box.
    if (!finalUps) {
      const rotationRetryPrompt = `Extract ONLY the UPS serial from the Gizzu sticker. The real serial is printed BELOW the barcode and has format GU18W12V + 10 digits = EXACTLY 18 chars. The small "GU18W12V" text above the barcode is the MODEL CODE, not the serial. If you cannot read the 10 digits clearly, return found:false — NEVER pad with zeros. Return JSON: {"upsSerial":{"found":true,"serial":"...","confidence":0.95}}`;
      try {
        const sharp = (await import("sharp")).default;
        const imgBuffer = Buffer.from(base64, "base64");
        for (const angle of [180, 90, 270]) {
          if (finalUps) break;
          try {
            vlmLogger.info(`UPS serial missing — retrying with ${angle}° rotated image`);
            const rotatedBuffer = await sharp(imgBuffer).rotate(angle).jpeg({ quality: 85 }).toBuffer();
            const rotatedBase64 = rotatedBuffer.toString("base64");
            const rotResult = await callVlmExtraction<{ upsSerial: { found: boolean; serial: string | null; confidence: number } }>(rotatedBase64, rotationRetryPrompt, `WA UPS retry ${angle}°`);
            if (rotResult.success && rotResult.data?.upsSerial?.found && rotResult.data.upsSerial.serial) {
              const rn = rotResult.data.upsSerial.serial.trim().toUpperCase().replace(/[\s-]/g, "");
              if (rotResult.data.upsSerial.confidence >= VLM_CONFIDENCE_FLOOR && isValidUpsSerial(rn)) {
                finalUps = rn;
                upsConfidence = rotResult.data.upsSerial.confidence;
                vlmLogger.info(`UPS recovered via ${angle}° rotation: ${finalUps}`);
              }
            }
          } catch (innerErr) {
            vlmLogger.warn(`UPS ${angle}° rotation retry failed: ${innerErr}`);
          }
        }
      } catch (retryErr) { vlmLogger.warn(`UPS rotation retry failed: ${retryErr}`); }
    }

    const overallConfidence = Math.max(ontConfidence, upsConfidence);
    const success = !!finalOnt || !!finalUps;

    vlmLogger.info(
      `WA photo extraction: ONT=${finalOnt || 'none'} (${ontConfidence.toFixed(2)}), UPS=${finalUps || 'none'} (${upsConfidence.toFixed(2)})`
    );

    return {
      success,
      ontSerial: finalOnt,
      upsSerial: finalUps,
      confidence: overallConfidence,
      ontConfidence,
      upsConfidence,
      processingTimeMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      `WA photo extraction failed: ${message}`,
      undefined,
      'VlmExtraction'
    );

    return {
      success: false,
      ontSerial: null,
      upsSerial: null,
      confidence: 0,
      ontConfidence: 0,
      upsConfidence: 0,
      processingTimeMs: Date.now() - startTime,
      error: message,
    };
  }
}
