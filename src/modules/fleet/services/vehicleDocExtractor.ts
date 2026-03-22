/**
 * Vehicle Document Extractor
 *
 * Purpose: Extract structured data from vehicle document photos:
 * - License plate verification (front/rear)
 * - Licence disk details (disc number, VIN, expiry, etc.)
 * - Dispatch to the correct extractor based on analysis type
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import {
  LicensePlateExtractionResult,
  LicenseDiskExtractionResult,
  OdometerExtractionResult,
  FuelGaugeExtractionResult,
  FuelReceiptExtractionResult,
  VlmAnalysisType,
} from '../types/check-in.types';
import { getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';
import { callVlmApi, parseVlmJson } from './fleetVlmClient';
import { extractOdometerReading } from './odometerExtractor';
import { extractFuelLevel, extractFuelReceipt } from './fuelExtractor';

// ============================================================================
// PROMPTS
// ============================================================================

const LICENSE_PLATE_PROMPT = `You are analyzing a vehicle photo to extract the license plate.

TASK: Extract the license/number plate text from this photo.

INSTRUCTIONS:
1. Look for the vehicle's license plate
2. Read all characters on the plate
3. South African plates typically have format: XX 00-00 GP or similar
4. Include province letters if visible

RESPONSE FORMAT (JSON only, no other text):
{
  "plate_text": "XX 00-00 GP",
  "confidence": 0.95,
  "visible": true
}

If no plate visible or unreadable:
{
  "plate_text": null,
  "confidence": 0,
  "visible": false
}`;

const LICENSE_DISK_PROMPT = `You are analyzing a South African vehicle licence disk (license disk) photo.

TASK: Extract all vehicle details from this licence disk photo.

CONTEXT: A South African licence disk is a circular sticker displayed on vehicle windscreens. It contains:
- Disc number (the "NO." field, e.g., "4046048YMKK1")
- Registration/Licence number (e.g., "KR27FNGP")
- VIN (Vehicle Identification Number) - 17 characters
- Engine number
- Make (manufacturer)
- Description (model/type)
- Year of first registration
- Tare (unladen mass in kg)
- GVM (Gross Vehicle Mass in kg)
- Licence expiry date (Date of expiry/Vervaldatum)
- Colour (sometimes listed)

INSTRUCTIONS:
1. Look for all text fields on the licence disk
2. Extract each piece of information carefully
3. The disc number is labeled "NO." at the top of the disc
4. VIN is typically 17 characters long
5. Registration follows South African format (e.g., "XX 000-000 GP" or "XX00XXGP")
6. Extract the expiry date in YYYY-MM-DD format (look for "Date of expiry" or "Vervaldatum")
7. If a field is not visible or unreadable, use null

RESPONSE FORMAT (JSON only, no other text):
{
  "disc_number": "4046048YMKK1",
  "registration": "KR27FNGP",
  "vin": "JTMHV05J004302371",
  "engine_number": "1VD0525677",
  "make": "TOYOTA",
  "description": "Station wagon",
  "year": 2020,
  "tare": 2510,
  "gvm": 3350,
  "license_expiry": "2026-06-30",
  "color": "WHITE",
  "confidence": 0.85,
  "raw_text": "all visible text from the disk"
}

If the licence disk is not clearly visible or unreadable:
{
  "disc_number": null,
  "registration": null,
  "vin": null,
  "engine_number": null,
  "make": null,
  "description": null,
  "year": null,
  "tare": null,
  "gvm": null,
  "license_expiry": null,
  "color": null,
  "confidence": 0,
  "raw_text": "unreadable"
}`;

// ============================================================================
// LICENSE PLATE
// ============================================================================

/**
 * Verify license plate from vehicle photo.
 *
 * @param base64Image - Base64-encoded image of vehicle (front or rear)
 * @param expectedPlate - Expected license plate to verify against
 * @returns License plate verification result
 */
export async function verifyLicensePlate(
  base64Image: string,
  expectedPlate: string
): Promise<LicensePlateExtractionResult> {
  try {
    log.info(
      'FleetVlmService',
      `Verifying license plate (expected: ${expectedPlate})...`
    );

    // Inject HITL few-shot examples from past corrections (non-blocking on failure)
    let prompt = LICENSE_PLATE_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'fleet',
        analysisType: 'license_plate',
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      const fewShotSection = buildVlmFewShotPrompt(examples);
      if (fewShotSection) {
        prompt = `${fewShotSection}\n\n${LICENSE_PLATE_PROMPT}`;
        log.info('FleetVlmService', `Injecting ${examples.length} few-shot examples for license_plate`);
      }
    } catch (fewShotError) {
      log.warn('FleetVlmService', `Few-shot retrieval failed (continuing without): ${fewShotError}`);
    }

    const content = await callVlmApi(
      base64Image,
      prompt,
      'license_plate'
    );
    const result = parseVlmJson<{
      plate_text: string | null;
      confidence: number;
      visible: boolean;
    }>(content);

    const normalizePlate = (plate: string) =>
      plate.replace(/[\s-]/g, '').toUpperCase();

    const extractedNorm = result.plate_text
      ? normalizePlate(result.plate_text)
      : '';
    const expectedNorm = normalizePlate(expectedPlate);

    const matches = extractedNorm === expectedNorm;

    return {
      plateText: result.plate_text,
      matches,
      confidence: result.confidence || 0,
      expectedPlate,
    };
  } catch (error) {
    log.error(
      'FleetVlmService',
      `License plate verification failed: ${error}`
    );
    return {
      plateText: null,
      matches: false,
      confidence: 0,
      expectedPlate,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// LICENCE DISK
// ============================================================================

/**
 * Extract vehicle details from licence disk photo.
 *
 * @param base64Image - Base64-encoded image of the licence disk
 * @returns Licence disk extraction result with all vehicle details
 */
export async function extractLicenseDiskDetails(
  base64Image: string
): Promise<LicenseDiskExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting licence disk details...');

    // Inject HITL few-shot examples from past corrections (non-blocking on failure)
    let prompt = LICENSE_DISK_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'fleet',
        analysisType: 'license_disk',
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      const fewShotSection = buildVlmFewShotPrompt(examples);
      if (fewShotSection) {
        prompt = `${fewShotSection}\n\n${LICENSE_DISK_PROMPT}`;
        log.info('FleetVlmService', `Injecting ${examples.length} few-shot examples for license_disk`);
      }
    } catch (fewShotError) {
      log.warn('FleetVlmService', `Few-shot retrieval failed (continuing without): ${fewShotError}`);
    }

    const content = await callVlmApi(
      base64Image,
      prompt,
      'license_plate'
    );
    const result = parseVlmJson<{
      disc_number: string | null;
      registration: string | null;
      vin: string | null;
      engine_number: string | null;
      make: string | null;
      description: string | null;
      year: number | null;
      tare: number | null;
      gvm: number | null;
      license_expiry: string | null;
      color: string | null;
      confidence: number;
      raw_text: string;
    }>(content);

    const vin = result.vin;
    if (vin && vin.length !== 17) {
      log.warn(
        'FleetVlmService',
        `VIN length invalid (${vin.length}), expected 17 characters`
      );
    }

    return {
      discNumber: result.disc_number,
      registration: result.registration,
      vin: vin,
      engineNumber: result.engine_number,
      make: result.make?.toUpperCase() || null,
      description: result.description,
      year: result.year,
      tare: result.tare,
      gvm: result.gvm,
      licenseExpiry: result.license_expiry,
      color: result.color?.toUpperCase() || null,
      confidence: result.confidence || 0,
      rawText: result.raw_text || '',
    };
  } catch (error) {
    log.error('FleetVlmService', `Licence disk extraction failed: ${error}`);
    return {
      discNumber: null,
      registration: null,
      vin: null,
      engineNumber: null,
      make: null,
      description: null,
      year: null,
      tare: null,
      gvm: null,
      licenseExpiry: null,
      color: null,
      confidence: 0,
      rawText: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// DISPATCHER
// ============================================================================

/**
 * Process a check-in photo based on its analysis type.
 * Routes to the appropriate extractor.
 *
 * @param base64Image - Base64-encoded image
 * @param analysisType - Type of analysis to perform
 * @param expectedPlate - Expected license plate (for license_plate analysis)
 * @returns Analysis result appropriate for the given type
 */
export async function processCheckInPhoto(
  base64Image: string,
  analysisType: VlmAnalysisType,
  expectedPlate?: string
): Promise<
  | OdometerExtractionResult
  | LicensePlateExtractionResult
  | FuelGaugeExtractionResult
  | FuelReceiptExtractionResult
  | null
> {
  switch (analysisType) {
    case 'odometer':
      return extractOdometerReading(base64Image);
    case 'license_plate':
      return verifyLicensePlate(base64Image, expectedPlate || '');
    case 'fuel_gauge':
      return extractFuelLevel(base64Image);
    case 'fuel_receipt':
      return extractFuelReceipt(base64Image);
    case 'damage':
      // Damage photos don't need VLM analysis — they're documentation only
      return null;
    default:
      log.warn('FleetVlmService', `Unknown analysis type: ${analysisType}`);
      return null;
  }
}
