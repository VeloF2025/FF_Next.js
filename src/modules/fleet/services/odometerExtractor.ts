/**
 * Odometer Extractor
 *
 * Purpose: Extract odometer readings from vehicle dashboard photos using VLM.
 * Includes multi-pass verification and calibration-context awareness.
 * Validation logic lives in odometerValidator.ts.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { OdometerExtractionResult } from '../types/check-in.types';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
} from '@/services/vlmLearningService';
import { callVlmApi, parseVlmJson, getVehicleCalibration } from './fleetVlmClient';
import {
  validateOdometerReading,
  detectDigitConfusion,
  type OdometerValidationResult,
} from './odometerValidator';

// Re-export so callers that import from odometerExtractor still work
export { validateOdometerReading, detectDigitConfusion };
export type { OdometerValidationResult };

// ============================================================================
// PROMPTS
// ============================================================================

const ODOMETER_PROMPT = `You are a precision OCR system for vehicle odometer readings.

TASK: Extract the EXACT odometer/mileage reading digit-by-digit.

CRITICAL - DIGIT RECOGNITION:
- "1" has a single vertical stroke, "6" has a curved loop
- "2" has a curved top, "3" has two curved bumps on the right
- "7" has a horizontal top stroke, "1" does not
- "8" has two stacked loops, "0" has one loop
- "9" has loop at top with tail, "4" has straight lines meeting

FINDING THE ODOMETER:
1. The MAIN odometer shows TOTAL kilometers (usually 5-6 digits)
2. It is typically the LARGEST number display on the dashboard
3. IGNORE the trip meter (usually smaller, often starts with "A" or "B")
4. IGNORE the speedometer (has "km/h" or "mph" markings around it)
5. The odometer often has "km" or "ODO" nearby

EXTRACTION PROCESS:
1. Locate the main odometer display
2. Read EACH DIGIT individually from left to right
3. Double-check digits that look similar (1/6, 2/3, 7/1, 8/0)
4. Verify the total makes sense (typically 10,000 - 500,000 km for used vehicles)

RESPONSE FORMAT (JSON only, no markdown):
{
  "reading": 123456,
  "confidence": 0.95,
  "raw_text": "123456",
  "digit_breakdown": "1-2-3-4-5-6",
  "display_type": "digital|analog"
}

If odometer not visible/unreadable:
{
  "reading": null,
  "confidence": 0,
  "raw_text": "unreadable",
  "digit_breakdown": null,
  "display_type": null
}`;

function buildCalibrationAwarePrompt(
  calibrationBaseline: number,
  calibrationDate: string
): string {
  return `You are a precision OCR system for vehicle odometer readings.

CONTEXT: This vehicle was calibrated on ${calibrationDate} with a baseline odometer reading of ${calibrationBaseline} km.
The current reading should be >= ${calibrationBaseline} km (odometers only go up).

TASK: Extract the EXACT odometer/mileage reading digit-by-digit.

CRITICAL - DIGIT RECOGNITION:
- "1" has a single vertical stroke, "6" has a curved loop
- "2" has a curved top, "3" has two curved bumps on the right
- "7" has a horizontal top stroke, "1" does not
- "8" has two stacked loops, "0" has one loop
- "9" has loop at top with tail, "4" has straight lines meeting

FINDING THE ODOMETER:
1. The MAIN odometer shows TOTAL kilometers (usually 5-6 digits)
2. It is typically the LARGEST number display on the dashboard
3. IGNORE the trip meter (usually smaller, often starts with "A" or "B")
4. IGNORE the speedometer (has "km/h" or "mph" markings around it)
5. The odometer often has "km" or "ODO" nearby

EXTRACTION PROCESS:
1. Locate the main odometer display
2. Read EACH DIGIT individually from left to right
3. Double-check digits that look similar (1/6, 2/3, 7/1, 8/0)
4. Verify: reading should be >= ${calibrationBaseline} km (calibration baseline)

RESPONSE FORMAT (JSON only, no markdown):
{
  "reading": 123456,
  "confidence": 0.95,
  "raw_text": "123456",
  "digit_breakdown": "1-2-3-4-5-6",
  "display_type": "digital|analog"
}

If odometer not visible/unreadable:
{
  "reading": null,
  "confidence": 0,
  "raw_text": "unreadable",
  "digit_breakdown": null,
  "display_type": null
}`;
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

type OdometerVlmResult = {
  reading: number | null;
  confidence: number;
  raw_text: string;
  digit_breakdown?: string;
  display_type?: string;
};

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Extract odometer reading from dashboard photo with multi-pass verification.
 * Runs extraction twice and compares results to catch digit confusion errors.
 * Enhanced with few-shot learning from past corrections.
 *
 * @param base64Image - Base64-encoded image of the dashboard/odometer
 * @returns Odometer reading result with verification metadata
 */
export async function extractOdometerReading(
  base64Image: string
): Promise<OdometerExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting odometer reading (multi-pass with few-shot)...');

    let fewShotSection = '';
    try {
      const examples = await getVlmFewShotExamples({
        module: 'fleet',
        analysisType: 'odometer',
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      if (examples.length > 0) {
        fewShotSection = buildVlmFewShotPrompt(examples);
        log.info('FleetVlmService', `Injecting ${examples.length} few-shot examples for odometer`);
      }
    } catch (fewShotError) {
      log.warn('FleetVlmService', `Few-shot retrieval failed (continuing without): ${fewShotError}`);
    }

    const enhancedPrompt = fewShotSection
      ? `${ODOMETER_PROMPT}\n\n${fewShotSection}`
      : ODOMETER_PROMPT;

    const content1 = await callVlmApi(base64Image, enhancedPrompt, 'odometer');
    const result1 = parseVlmJson<OdometerVlmResult>(content1);
    log.info('FleetVlmService', `Pass 1: ${result1.reading} km (${result1.confidence} conf)`);

    if (!result1.reading || result1.confidence < 0.5) {
      return {
        reading: result1.reading,
        confidence: result1.confidence || 0,
        rawText: result1.raw_text || '',
        rawResponse: content1,
      };
    }

    const content2 = await callVlmApi(base64Image, enhancedPrompt, 'odometer');
    const result2 = parseVlmJson<OdometerVlmResult>(content2);
    log.info('FleetVlmService', `Pass 2: ${result2.reading} km (${result2.confidence} conf)`);

    const readingsMatch = result1.reading === result2.reading;
    const diff = Math.abs((result1.reading || 0) - (result2.reading || 0));
    const percentDiff = (diff / (result1.reading || 1)) * 100;

    if (!readingsMatch) {
      log.warn('FleetVlmService', `Multi-pass mismatch: ${result1.reading} vs ${result2.reading} (${percentDiff.toFixed(1)}% diff)`);

      if (percentDiff > 1) {
        const confusionDetected = detectDigitConfusion(
          String(result1.reading),
          String(result2.reading)
        );
        if (confusionDetected) {
          log.error('FleetVlmService', `Digit confusion detected: ${confusionDetected}`);
          return {
            reading: result1.reading,
            confidence: Math.min(result1.confidence, 0.6),
            rawText: `${result1.raw_text} (VERIFY: pass2=${result2.reading})`,
            warning: `Digit confusion detected: ${confusionDetected}`,
            rawResponse: `Pass1: ${content1}\nPass2: ${content2}`,
          };
        }
      }
    }

    const bestResult = result2.confidence > result1.confidence ? result2 : result1;
    const finalConfidence = readingsMatch
      ? Math.min(bestResult.confidence + 0.05, 1.0)
      : Math.max(bestResult.confidence - 0.1, 0.5);

    if (bestResult.reading && finalConfidence >= 0.7) {
      recordCorrectExtraction('fleet', 'odometer', finalConfidence).catch(() => {});
    }

    return {
      reading: bestResult.reading,
      confidence: finalConfidence,
      rawText: bestResult.raw_text || '',
      rawResponse: `Pass1: ${result1.reading} (${result1.confidence}), Pass2: ${result2.reading} (${result2.confidence})`,
    };
  } catch (error) {
    log.error('FleetVlmService', `Odometer extraction failed: ${error}`);
    return {
      reading: null,
      confidence: 0,
      rawText: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract odometer reading with calibration context.
 * Uses calibration baseline for better validation.
 *
 * @param base64Image - Current dashboard photo (base64)
 * @param vehicleId - Vehicle UUID to fetch calibration data
 * @returns Enhanced extraction result with calibration-aware validation
 */
export async function extractOdometerWithCalibration(
  base64Image: string,
  vehicleId: string
): Promise<OdometerExtractionResult & { calibrationUsed: boolean; baselineOdometer?: number }> {
  try {
    const calibration = await getVehicleCalibration(vehicleId);

    if (!calibration) {
      log.info('FleetVlmService', `No calibration found for vehicle ${vehicleId}, using standard extraction`);
      const result = await extractOdometerReading(base64Image);
      return { ...result, calibrationUsed: false };
    }

    log.info('FleetVlmService', `Using calibration context: baseline=${calibration.baselineOdometer} km`);

    const prompt = buildCalibrationAwarePrompt(
      calibration.baselineOdometer,
      new Date(calibration.calibratedAt).toISOString().split('T')[0]
    );

    const content1 = await callVlmApi(base64Image, prompt, 'odometer');
    const result1 = parseVlmJson<OdometerVlmResult>(content1);
    log.info('FleetVlmService', `Calibration-aware Pass 1: ${result1.reading} km (${result1.confidence} conf)`);

    if (!result1.reading || result1.confidence < 0.5) {
      log.info('FleetVlmService', 'Calibration pass failed, falling back to standard extraction');
      const fallback = await extractOdometerReading(base64Image);
      return { ...fallback, calibrationUsed: false };
    }

    if (result1.reading < calibration.baselineOdometer) {
      log.warn('FleetVlmService', `Reading ${result1.reading} km is below calibration baseline ${calibration.baselineOdometer} km`);
      return {
        reading: result1.reading,
        confidence: Math.min(result1.confidence, 0.5),
        rawText: result1.raw_text || '',
        warning: `Reading below calibration baseline (${calibration.baselineOdometer} km)`,
        rawResponse: content1,
        calibrationUsed: true,
        baselineOdometer: calibration.baselineOdometer,
      };
    }

    const content2 = await callVlmApi(base64Image, prompt, 'odometer');
    const result2 = parseVlmJson<OdometerVlmResult>(content2);
    log.info('FleetVlmService', `Calibration-aware Pass 2: ${result2.reading} km (${result2.confidence} conf)`);

    const readingsMatch = result1.reading === result2.reading;
    const bestResult = result2.confidence > result1.confidence ? result2 : result1;
    const finalConfidence = readingsMatch
      ? Math.min(bestResult.confidence + 0.05, 1.0)
      : Math.max(bestResult.confidence - 0.1, 0.5);

    return {
      reading: bestResult.reading,
      confidence: finalConfidence,
      rawText: bestResult.raw_text || '',
      rawResponse: `Calibration-aware: Pass1=${result1.reading}, Pass2=${result2.reading}`,
      calibrationUsed: true,
      baselineOdometer: calibration.baselineOdometer,
    };
  } catch (error) {
    log.error('FleetVlmService', `Calibration-aware extraction failed: ${error}`);
    const fallback = await extractOdometerReading(base64Image);
    return { ...fallback, calibrationUsed: false };
  }
}

/**
 * Enhanced odometer extraction with validation.
 * Gets previous reading from database and validates the extracted value.
 * Uses calibration data for better accuracy.
 */
export async function extractAndValidateOdometerReading(
  base64Image: string,
  vehicleId: string,
  getPreviousReading: () => Promise<number | null>
): Promise<OdometerExtractionResult & { validation: OdometerValidationResult; calibrationUsed?: boolean }> {
  const extractionResult = await extractOdometerWithCalibration(base64Image, vehicleId);
  const previousReading = await getPreviousReading();
  const effectivePrevious = previousReading ?? extractionResult.baselineOdometer ?? null;

  const validation = validateOdometerReading(
    extractionResult.reading,
    extractionResult.confidence,
    effectivePrevious,
    { minConfidence: extractionResult.calibrationUsed ? 0.8 : 0.85 }
  );

  log.info(
    'FleetVlmService',
    `ODO validation: extracted=${extractionResult.reading}, previous=${effectivePrevious}, calibration=${extractionResult.calibrationUsed}, action=${validation.suggestedAction}`
  );

  if (validation.warning) {
    log.warn('FleetVlmService', `ODO warning: ${validation.warning}`);
  }

  return { ...extractionResult, validation, calibrationUsed: extractionResult.calibrationUsed };
}
