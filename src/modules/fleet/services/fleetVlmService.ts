/**
 * Fleet VLM (Vision Language Model) Service
 * Extracts data from vehicle check-in photos using Qwen3-VL-8B-Instruct
 *
 * Features:
 * - Odometer OCR extraction
 * - License plate verification
 * - Fuel gauge level reading
 */

import { log } from '@/lib/logger';
import sharp from 'sharp';
import { neon } from '@/lib/db-neon';
import {
  OdometerExtractionResult,
  LicensePlateExtractionResult,
  FuelGaugeExtractionResult,
  FuelReceiptExtractionResult,
  LicenseDiskExtractionResult,
  VlmAnalysisType,
} from '../types/check-in.types';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
} from '@/services/vlmLearningService';

// Database connection for calibration queries
const sql = neon(process.env.DATABASE_URL!);

// VLM API configuration
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.FLEET_VLM_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 60000; // 1 minute for single image

// Image size limits for VLM processing
// Large images (4K+) cause token limit errors and incorrect readings
const VLM_MAX_WIDTH = 1280;
const VLM_MAX_HEIGHT = 960;
const VLM_JPEG_QUALITY = 85;

// ============================================================================
// Calibration Data Types
// ============================================================================

export interface VehicleCalibration {
  id: string;
  vehicleId: string;
  calibratedAt: string;
  calibratedByName: string | null;
  baselineOdometer: number;
  baselineFuelLevel: number;
  dashboardPhotoUrl: string | null;
  vlmLearningStatus: 'pending' | 'learning' | 'ready';
}

/**
 * Resize image to fit within VLM limits
 * CRITICAL: 4K images (4032x3024) cause VLM to misread odometer/fuel readings
 * Resizing to ~1280x960 fixes accuracy issues
 */
async function resizeImageForVlm(base64Image: string): Promise<string> {
  try {
    const inputBuffer = Buffer.from(base64Image, 'base64');

    // Get image metadata to check if resizing is needed
    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const format = metadata.format || 'unknown';

    const needsResize = width > VLM_MAX_WIDTH || height > VLM_MAX_HEIGHT;
    const needsConvert = format !== 'jpeg' && format !== 'jpg';

    if (!needsResize && !needsConvert) {
      log.info('FleetVlmService', `Image ${width}x${height} JPEG already within limits, skipping`);
      return base64Image;
    }

    log.info('FleetVlmService', `Processing image ${width}x${height} ${format} (resize: ${needsResize}, convert: ${needsConvert})`);

    let pipeline = sharp(inputBuffer);
    if (needsResize) {
      pipeline = pipeline.resize(VLM_MAX_WIDTH, VLM_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const outputBuffer = await pipeline.jpeg({ quality: VLM_JPEG_QUALITY }).toBuffer();

    const outputBase64 = outputBuffer.toString('base64');

    const originalSize = Math.round(inputBuffer.length / 1024);
    const outputSize = Math.round(outputBuffer.length / 1024);
    log.info('FleetVlmService', `Image processed: ${originalSize}KB -> ${outputSize}KB (${format} -> jpeg)`);

    return outputBase64;
  } catch (error) {
    log.error('FleetVlmService', `Image processing failed: ${error}`);
    throw new FleetVlmError(
      `Failed to process image for VLM: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'IMAGE_PROCESSING_ERROR',
      error
    );
  }
}

/**
 * VLM API Error
 */
export class FleetVlmError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'FleetVlmError';
  }
}

// ============================================================================
// Calibration Helpers
// ============================================================================

/**
 * Fetch active calibration data for a vehicle
 * Used for VLM validation and few-shot learning context
 */
export async function getVehicleCalibration(vehicleId: string): Promise<VehicleCalibration | null> {
  try {
    const result = await sql`
      SELECT
        id, vehicle_id, calibrated_at, calibrated_by_name,
        baseline_odometer, baseline_fuel_level,
        dashboard_photo_url, vlm_learning_status
      FROM fleet_vehicle_calibration
      WHERE vehicle_id = ${vehicleId} AND is_active = true
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      calibratedAt: row.calibrated_at,
      calibratedByName: row.calibrated_by_name,
      baselineOdometer: row.baseline_odometer,
      baselineFuelLevel: row.baseline_fuel_level,
      dashboardPhotoUrl: row.dashboard_photo_url,
      vlmLearningStatus: row.vlm_learning_status || 'pending',
    };
  } catch (error) {
    log.error('FleetVlmService', `Failed to fetch calibration: ${error}`);
    return null;
  }
}

/**
 * Fetch reference photo as base64 for few-shot learning
 * Returns null if photo not available or fetch fails
 */
async function fetchCalibrationPhotoBase64(photoUrl: string | null): Promise<string | null> {
  if (!photoUrl) return null;

  try {
    // Construct full URL if relative path
    const fullUrl = photoUrl.startsWith('http')
      ? photoUrl
      : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}${photoUrl}`;

    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.warn('FleetVlmService', `Failed to fetch calibration photo: ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (error) {
    log.error('FleetVlmService', `Error fetching calibration photo: ${error}`);
    return null;
  }
}

// ============================================================================
// VLM Prompts
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

const FUEL_GAUGE_PROMPT = `TASK: Read the FUEL GAUGE in this vehicle dashboard photo.

HOW TO FIND THE FUEL GAUGE:
1. Look for a gauge with "E" (Empty) and "F" (Full) markings
2. Usually has a fuel pump icon (⛽) next to it
3. It is a SMALL gauge, NOT the large speedometer
4. NOT the temperature gauge (has C/H or blue/red markings)

HOW TO READ THE FUEL LEVEL:
- E (Empty) = 0% fuel
- F (Full) = 100% fuel
- Most gauges: E is on LEFT, F is on RIGHT
- The NEEDLE points to current fuel level
- Look at where the needle tip is pointing between E and F

ANSWER OPTIONS - pick the closest:
- "empty" = 0% (needle at E)
- "1/4" = 25% (needle 1/4 way from E to F)
- "1/2" = 50% (needle halfway between E and F)
- "3/4" = 75% (needle 3/4 way from E to F)
- "full" = 100% (needle at F)

Reply with JSON only:
{"level_category": "<empty|1/4|1/2|3/4|full>", "level": <0-100>, "confidence": <0.0-1.0>, "description": "<where is the needle pointing, e.g. 'needle between E and first mark'>"}

If fuel gauge not visible:
{"level_category": null, "level": null, "confidence": 0, "description": "Fuel gauge not found"}`;

const FUEL_RECEIPT_PROMPT = `You are analyzing a fuel station receipt or invoice photo.

TASK: Extract fuel purchase details from this receipt.

INSTRUCTIONS:
1. Find the total amount paid (in Rand/ZAR)
2. Find the number of litres purchased
3. Find the price per litre (if shown)
4. Find the date of the transaction
5. Find the station name/brand (e.g., Shell, BP, Engen, Caltex, Total)
6. Find the station location/address if visible

SOUTH AFRICAN CONTEXT:
- Currency is ZAR/Rand, written as R or ZAR
- Common fuel types: 93, 95 (petrol/gasoline), Diesel, 500ppm
- Common stations: Shell, BP, Engen, Caltex, Total, Sasol

RESPONSE FORMAT (JSON only, no other text):
{
  "amount_rand": 850.50,
  "litres": 45.25,
  "price_per_litre": 18.79,
  "date": "2025-01-14",
  "station_name": "Shell",
  "station_location": "123 Main Road, Johannesburg",
  "fuel_type": "95",
  "confidence": 0.90
}

If receipt is not readable or not a fuel receipt:
{
  "amount_rand": null,
  "litres": null,
  "price_per_litre": null,
  "date": null,
  "station_name": null,
  "station_location": null,
  "fuel_type": null,
  "confidence": 0
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
// Helper Functions
// ============================================================================

/**
 * Call VLM API with a single image and prompt
 * IMPORTANT: Images are automatically resized to prevent token limit errors
 */
async function callVlmApi(
  base64Image: string,
  prompt: string,
  analysisType: VlmAnalysisType
): Promise<string> {
  // CRITICAL: Resize large images to prevent VLM misreads
  // 4K images (4032x3024) cause VLM to drop digits or misread values
  const resizedImage = await resizeImageForVlm(base64Image);

  const requestBody = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${resizedImage}`,
            },
          },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1, // Low temperature for consistent extraction
  };

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new FleetVlmError(
        `VLM API returned ${response.status}: ${errorText}`,
        `VLM_HTTP_${response.status}`,
        errorText
      );
    }

    const data = await response.json();
    const processingTime = Date.now() - startTime;

    log.info('FleetVlmService', `${analysisType} VLM call completed in ${processingTime}ms`);

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new FleetVlmError('No content in VLM response', 'NO_CONTENT');
    }

    return content;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FleetVlmError('VLM API request timed out', 'VLM_TIMEOUT');
    }
    if (error instanceof FleetVlmError) {
      throw error;
    }
    throw new FleetVlmError(
      `VLM API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'VLM_API_ERROR',
      error
    );
  }
}

/**
 * Parse JSON from VLM response (handles markdown code blocks)
 */
function parseVlmJson<T>(content: string): T {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch =
    content.match(/```json\n([\s\S]*?)\n```/) ||
    content.match(/```\n([\s\S]*?)\n```/) ||
    [null, content];

  const jsonStr = (jsonMatch[1] || content).trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    log.error('FleetVlmService', `Failed to parse VLM JSON: ${content}`);
    throw new FleetVlmError('Invalid JSON in VLM response', 'PARSE_ERROR');
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract odometer reading from dashboard photo with multi-pass verification
 * Runs extraction twice and compares results to catch digit confusion errors
 * Now enhanced with few-shot learning from past corrections
 * @param base64Image - Base64-encoded image of the dashboard/odometer
 * @returns Odometer reading result with verification metadata
 */
export async function extractOdometerReading(
  base64Image: string
): Promise<OdometerExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting odometer reading (multi-pass with few-shot)...');

    // Get few-shot examples from past corrections (non-blocking, don't fail if unavailable)
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

    // Build enhanced prompt with few-shot examples
    const enhancedPrompt = fewShotSection
      ? `${ODOMETER_PROMPT}\n\n${fewShotSection}`
      : ODOMETER_PROMPT;

    // First pass
    const content1 = await callVlmApi(base64Image, enhancedPrompt, 'odometer');
    const result1 = parseVlmJson<{
      reading: number | null;
      confidence: number;
      raw_text: string;
      digit_breakdown?: string;
      display_type?: string;
    }>(content1);

    log.info('FleetVlmService', `Pass 1: ${result1.reading} km (${result1.confidence} conf)`);

    // If first pass failed or low confidence, return early
    if (!result1.reading || result1.confidence < 0.5) {
      return {
        reading: result1.reading,
        confidence: result1.confidence || 0,
        rawText: result1.raw_text || '',
        rawResponse: content1,
      };
    }

    // Second pass for verification (catches digit confusion)
    const content2 = await callVlmApi(base64Image, enhancedPrompt, 'odometer');
    const result2 = parseVlmJson<{
      reading: number | null;
      confidence: number;
      raw_text: string;
      digit_breakdown?: string;
      display_type?: string;
    }>(content2);

    log.info('FleetVlmService', `Pass 2: ${result2.reading} km (${result2.confidence} conf)`);

    // Compare results
    const readingsMatch = result1.reading === result2.reading;
    const diff = Math.abs((result1.reading || 0) - (result2.reading || 0));
    const percentDiff = (diff / (result1.reading || 1)) * 100;

    if (!readingsMatch) {
      log.warn('FleetVlmService', `Multi-pass mismatch: ${result1.reading} vs ${result2.reading} (${percentDiff.toFixed(1)}% diff)`);

      // If readings differ significantly (>1%), flag for review
      if (percentDiff > 1) {
        // Check for common digit confusion patterns (1↔6, 2↔3)
        const str1 = String(result1.reading);
        const str2 = String(result2.reading);
        const confusionDetected = detectDigitConfusion(str1, str2);

        if (confusionDetected) {
          log.error('FleetVlmService', `Digit confusion detected: ${confusionDetected}`);
          // Return lower confidence and flag the issue
          return {
            reading: result1.reading, // Use first reading but with warning
            confidence: Math.min(result1.confidence, 0.6), // Cap confidence
            rawText: `${result1.raw_text} (VERIFY: pass2=${result2.reading})`,
            warning: `Digit confusion detected: ${confusionDetected}`,
            rawResponse: `Pass1: ${content1}\nPass2: ${content2}`,
          };
        }
      }
    }

    // Use the reading with higher confidence, or first if equal
    const bestResult = result2.confidence > result1.confidence ? result2 : result1;
    const finalConfidence = readingsMatch
      ? Math.min(bestResult.confidence + 0.05, 1.0) // Boost confidence if both passes agree
      : Math.max(bestResult.confidence - 0.1, 0.5); // Reduce if they disagree

    // Record successful extraction metric (non-blocking)
    if (bestResult.reading && finalConfidence >= 0.7) {
      recordCorrectExtraction('fleet', 'odometer', finalConfidence).catch(() => {
        // Silently ignore metric recording failures
      });
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
 * Few-shot prompt with calibration reference for better odometer extraction
 */
function buildFewShotOdometerPrompt(
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

/**
 * Extract odometer reading with calibration context (few-shot enhanced)
 * Uses calibration baseline for better validation and optionally reference photo
 * @param base64Image - Current dashboard photo (base64)
 * @param vehicleId - Vehicle UUID to fetch calibration data
 * @returns Enhanced extraction result with calibration-aware validation
 */
export async function extractOdometerWithCalibration(
  base64Image: string,
  vehicleId: string
): Promise<OdometerExtractionResult & { calibrationUsed: boolean; baselineOdometer?: number }> {
  try {
    // Fetch calibration data for this vehicle
    const calibration = await getVehicleCalibration(vehicleId);

    if (!calibration) {
      log.info('FleetVlmService', `No calibration found for vehicle ${vehicleId}, using standard extraction`);
      const result = await extractOdometerReading(base64Image);
      return { ...result, calibrationUsed: false };
    }

    log.info('FleetVlmService', `Using calibration context: baseline=${calibration.baselineOdometer} km`);

    // Build few-shot prompt with calibration context
    const prompt = buildFewShotOdometerPrompt(
      calibration.baselineOdometer,
      new Date(calibration.calibratedAt).toISOString().split('T')[0]
    );

    // First pass with calibration-aware prompt
    const content1 = await callVlmApi(base64Image, prompt, 'odometer');
    const result1 = parseVlmJson<{
      reading: number | null;
      confidence: number;
      raw_text: string;
      digit_breakdown?: string;
      display_type?: string;
    }>(content1);

    log.info('FleetVlmService', `Calibration-aware Pass 1: ${result1.reading} km (${result1.confidence} conf)`);

    // If first pass failed or low confidence, try standard extraction
    if (!result1.reading || result1.confidence < 0.5) {
      log.info('FleetVlmService', 'Calibration pass failed, falling back to standard extraction');
      const fallback = await extractOdometerReading(base64Image);
      return { ...fallback, calibrationUsed: false };
    }

    // Validate against calibration baseline
    if (result1.reading < calibration.baselineOdometer) {
      log.warn('FleetVlmService', `Reading ${result1.reading} km is below calibration baseline ${calibration.baselineOdometer} km`);
      // This is suspicious - odometer shouldn't go backwards
      return {
        reading: result1.reading,
        confidence: Math.min(result1.confidence, 0.5), // Reduce confidence
        rawText: result1.raw_text || '',
        warning: `Reading below calibration baseline (${calibration.baselineOdometer} km)`,
        rawResponse: content1,
        calibrationUsed: true,
        baselineOdometer: calibration.baselineOdometer,
      };
    }

    // Second pass for verification
    const content2 = await callVlmApi(base64Image, prompt, 'odometer');
    const result2 = parseVlmJson<{
      reading: number | null;
      confidence: number;
      raw_text: string;
      digit_breakdown?: string;
      display_type?: string;
    }>(content2);

    log.info('FleetVlmService', `Calibration-aware Pass 2: ${result2.reading} km (${result2.confidence} conf)`);

    // Compare results
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
    // Fall back to standard extraction
    const fallback = await extractOdometerReading(base64Image);
    return { ...fallback, calibrationUsed: false };
  }
}

/**
 * Detect common digit confusion patterns between two number strings
 * Returns description of confusion or null if no pattern found
 */
function detectDigitConfusion(str1: string, str2: string): string | null {
  if (str1.length !== str2.length) return null;

  const confusionPairs: Record<string, string[]> = {
    '1': ['6', '7'],
    '6': ['1', '8'],
    '2': ['3', '7'],
    '3': ['2', '8'],
    '7': ['1', '2'],
    '8': ['3', '6', '0'],
    '0': ['8', '6'],
  };

  const differences: string[] = [];
  for (let i = 0; i < str1.length; i++) {
    if (str1[i] !== str2[i]) {
      const d1 = str1[i];
      const d2 = str2[i];
      if (confusionPairs[d1]?.includes(d2) || confusionPairs[d2]?.includes(d1)) {
        differences.push(`position ${i + 1}: ${d1}↔${d2}`);
      }
    }
  }

  return differences.length > 0 ? differences.join(', ') : null;
}

/**
 * Verify license plate from vehicle photo
 * @param base64Image - Base64-encoded image of vehicle (front or rear)
 * @param expectedPlate - Expected license plate to verify against
 * @returns License plate verification result
 */
export async function verifyLicensePlate(
  base64Image: string,
  expectedPlate: string
): Promise<LicensePlateExtractionResult> {
  try {
    log.info('FleetVlmService', `Verifying license plate (expected: ${expectedPlate})...`);

    const content = await callVlmApi(base64Image, LICENSE_PLATE_PROMPT, 'license_plate');
    const result = parseVlmJson<{
      plate_text: string | null;
      confidence: number;
      visible: boolean;
    }>(content);

    // Normalize plates for comparison (remove spaces, dashes, convert to uppercase)
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
    log.error('FleetVlmService', `License plate verification failed: ${error}`);
    return {
      plateText: null,
      matches: false,
      confidence: 0,
      expectedPlate,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Map categorical fuel level to percentage
 */
function categoryToPercent(category: string | null): number | null {
  if (!category) return null;
  const normalized = category.toLowerCase().trim();
  const mapping: Record<string, number> = {
    'empty': 0,
    '1/4': 25,
    '1/2': 50,
    '3/4': 75,
    'full': 100,
  };
  return mapping[normalized] ?? null;
}

/**
 * Extract fuel gauge level from dashboard photo
 * @param base64Image - Base64-encoded image of fuel gauge
 * @returns Fuel level result (0-100 percentage)
 */
export async function extractFuelLevel(
  base64Image: string
): Promise<FuelGaugeExtractionResult> {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.info('FleetVlmService', `Extracting fuel gauge level (attempt ${attempt}/${MAX_RETRIES})...`);

      const content = await callVlmApi(base64Image, FUEL_GAUGE_PROMPT, 'fuel_gauge');
      const result = parseVlmJson<{
        level_category?: string | null;
        level: number | null;
        confidence: number;
        description: string;
      }>(content);

      // Prefer categorical level if available (more reliable)
      let level = result.level;
      if (result.level_category) {
        const categoryLevel = categoryToPercent(result.level_category);
        if (categoryLevel !== null) {
          log.info('FleetVlmService', `Using categorical level: ${result.level_category} -> ${categoryLevel}%`);
          level = categoryLevel;
        }
      }

      // Ensure level is within 0-100 range
      if (level !== null) {
        level = Math.max(0, Math.min(100, level));
      }

      // If confidence is very low but we got a value, log a warning but still return it
      if (level !== null && (result.confidence || 0) < 0.4) {
        log.warn('FleetVlmService', `Low confidence fuel gauge read: ${level}% @ ${result.confidence} conf — attempt ${attempt}`);
      }

      return {
        level,
        confidence: result.confidence || 0,
        description: result.description || '',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error('FleetVlmService', `Fuel gauge extraction attempt ${attempt} failed: ${errMsg}`);

      // Retry on timeout or parse errors, not on permanent failures
      const isRetryable = errMsg.includes('timeout') || errMsg.includes('PARSE_ERROR') || errMsg.includes('NO_CONTENT');
      if (attempt < MAX_RETRIES && isRetryable) {
        log.info('FleetVlmService', `Retrying fuel gauge extraction (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt)); // 1.5s, 3s backoff
        continue;
      }

      return {
        level: null,
        confidence: 0,
        description: 'Could not read fuel gauge from photo',
        error: errMsg,
      };
    }
  }

  // Fallback (should not reach here)
  return {
    level: null,
    confidence: 0,
    description: 'Extraction failed after retries',
    error: 'Max retries exceeded',
  };
}

/**
 * Extract fuel level with calibration context
 * Uses calibration baseline to validate large fuel changes
 * @param base64Image - Current dashboard photo (base64)
 * @param vehicleId - Vehicle UUID to fetch calibration data
 * @param previousFuelLevel - Previous fuel level (0-100) for comparison
 * @returns Enhanced fuel extraction with calibration awareness
 */
export async function extractFuelLevelWithCalibration(
  base64Image: string,
  vehicleId: string,
  previousFuelLevel?: number | null
): Promise<FuelGaugeExtractionResult & { calibrationUsed: boolean; baselineFuelLevel?: number }> {
  try {
    // Standard extraction first
    const result = await extractFuelLevel(base64Image);

    // Fetch calibration for context
    const calibration = await getVehicleCalibration(vehicleId);

    if (!calibration) {
      return { ...result, calibrationUsed: false };
    }

    log.info('FleetVlmService', `Fuel calibration context: baseline=${calibration.baselineFuelLevel}%`);

    // Validate fuel level changes
    // Large increases without refueling context might indicate misread
    const prevLevel = previousFuelLevel ?? calibration.baselineFuelLevel;
    if (result.level !== null && prevLevel !== null) {
      const fuelChange = result.level - prevLevel;

      // Fuel increase of more than 60% without being near empty is suspicious
      if (fuelChange > 60 && prevLevel > 30) {
        log.warn('FleetVlmService', `Suspicious fuel increase: ${prevLevel}% -> ${result.level}% (+${fuelChange}%)`);
        return {
          ...result,
          confidence: Math.min(result.confidence, 0.7),
          description: `${result.description} (Warning: Large increase from ${prevLevel}%)`,
          calibrationUsed: true,
          baselineFuelLevel: calibration.baselineFuelLevel,
        };
      }
    }

    return {
      ...result,
      calibrationUsed: true,
      baselineFuelLevel: calibration.baselineFuelLevel,
    };
  } catch (error) {
    log.error('FleetVlmService', `Calibration-aware fuel extraction failed: ${error}`);
    const fallback = await extractFuelLevel(base64Image);
    return { ...fallback, calibrationUsed: false };
  }
}

/**
 * Extract fuel purchase details from receipt photo
 * @param base64Image - Base64-encoded image of fuel receipt
 * @returns Fuel receipt extraction result with amount, litres, date, station info
 */
export async function extractFuelReceipt(
  base64Image: string
): Promise<FuelReceiptExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting fuel receipt data...');

    const content = await callVlmApi(base64Image, FUEL_RECEIPT_PROMPT, 'fuel_receipt');
    const result = parseVlmJson<{
      amount_rand: number | null;
      litres: number | null;
      price_per_litre: number | null;
      date: string | null;
      station_name: string | null;
      station_location: string | null;
      fuel_type: string | null;
      confidence: number;
    }>(content);

    return {
      amountRand: result.amount_rand,
      litres: result.litres,
      pricePerLitre: result.price_per_litre,
      date: result.date,
      stationName: result.station_name,
      stationLocation: result.station_location,
      fuelType: result.fuel_type,
      confidence: result.confidence || 0,
    };
  } catch (error) {
    log.error('FleetVlmService', `Fuel receipt extraction failed: ${error}`);
    return {
      amountRand: null,
      litres: null,
      pricePerLitre: null,
      date: null,
      stationName: null,
      stationLocation: null,
      fuelType: null,
      confidence: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract vehicle details from licence disk photo
 * @param base64Image - Base64-encoded image of the licence disk
 * @returns Licence disk extraction result with all vehicle details
 */
export async function extractLicenseDiskDetails(
  base64Image: string
): Promise<LicenseDiskExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting licence disk details...');

    const content = await callVlmApi(base64Image, LICENSE_DISK_PROMPT, 'license_plate');
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

    // Validate VIN length if present
    const vin = result.vin;
    if (vin && vin.length !== 17) {
      log.warn('FleetVlmService', `VIN length invalid (${vin.length}), expected 17 characters`);
      // Keep it but note the issue
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

/**
 * Process a check-in photo based on its type
 * @param base64Image - Base64-encoded image
 * @param analysisType - Type of analysis to perform
 * @param expectedPlate - Expected license plate (for license_plate analysis)
 * @returns Analysis result
 */
export async function processCheckInPhoto(
  base64Image: string,
  analysisType: VlmAnalysisType,
  expectedPlate?: string
): Promise<OdometerExtractionResult | LicensePlateExtractionResult | FuelGaugeExtractionResult | FuelReceiptExtractionResult | null> {
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
      // Damage photos don't need VLM analysis - they're just documentation
      return null;
    default:
      log.warn('FleetVlmService', `Unknown analysis type: ${analysisType}`);
      return null;
  }
}

/**
 * Check VLM service health
 * @returns true if VLM service is available
 */
export async function checkFleetVlmHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${VLM_API_BASE}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const hasModel = data.data?.some(
      (m: { id: string }) => m.id === VLM_MODEL || m.id.includes('Qwen')
    );

    if (!hasModel) {
      log.warn('FleetVlmService', `${VLM_MODEL} model not found in vLLM`);
    }

    return hasModel;
  } catch (error) {
    log.error('FleetVlmService', `VLM health check failed: ${error}`);
    return false;
  }
}

/**
 * Get fuel level description from percentage
 */
export function getFuelLevelDescription(level: number): string {
  if (level <= 10) return 'Empty';
  if (level <= 30) return 'Quarter';
  if (level <= 55) return 'Half';
  if (level <= 80) return 'Three-quarters';
  return 'Full';
}

// ============================================================================
// VLM Sanity Checks / Validation
// ============================================================================

export interface OdometerValidationResult {
  isValid: boolean;
  validatedReading: number | null;
  originalReading: number | null;
  warning: string | null;
  warningLevel: 'none' | 'low' | 'medium' | 'high';
  suggestedAction: 'accept' | 'verify' | 'reject';
}

/**
 * Validate odometer reading against previous value and VLM confidence
 * Returns validation result with warnings if the reading seems suspicious
 * STRICT MODE: Rejects readings with impossible jumps (likely VLM digit confusion)
 */
export function validateOdometerReading(
  extractedReading: number | null,
  confidence: number,
  previousReading: number | null,
  options?: {
    maxDailyKm?: number;      // Max expected km per day (default 500)
    maxSingleTripKm?: number; // Max km for a single check-in difference (default 1000)
    minConfidence?: number;   // Min VLM confidence to auto-accept (default 0.85)
    daysSinceLast?: number;   // Days since last reading (for proportional validation)
  }
): OdometerValidationResult {
  const {
    maxDailyKm = 500,
    maxSingleTripKm = 1000,
    minConfidence = 0.85,
    daysSinceLast = 1,
  } = options || {};

  // No reading extracted
  if (extractedReading === null) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: null,
      warning: 'Could not extract odometer reading from image',
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  // Basic range check (reasonable odometer values: 0 - 2,000,000 km)
  if (extractedReading < 0 || extractedReading > 2000000) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Reading ${extractedReading} km is outside reasonable range (0-2,000,000)`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  // Low confidence warning
  if (confidence < minConfidence) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Low VLM confidence (${Math.round(confidence * 100)}%) - verify manually`,
      warningLevel: 'medium',
      suggestedAction: 'verify',
    };
  }

  // No previous reading to compare - accept with low confidence warning
  if (previousReading === null) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: null,
      warningLevel: 'none',
      suggestedAction: 'accept',
    };
  }

  // Calculate difference
  const kmDifference = extractedReading - previousReading;

  // Odometer went backwards (impossible without tampering)
  if (kmDifference < -10) { // Allow tiny margin for digit extraction errors
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Odometer appears to have gone backwards: ${extractedReading} km < previous ${previousReading} km`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  // Calculate proportional threshold based on days
  const proportionalMaxKm = Math.max(maxDailyKm * Math.max(daysSinceLast, 1), maxSingleTripKm);

  // Check for digit confusion pattern (common VLM error)
  const extractedStr = extractedReading.toString();
  const previousStr = previousReading.toString();
  const digitConfusion = detectDigitConfusionValidation(extractedStr, previousStr, kmDifference);

  if (digitConfusion) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `VLM digit confusion detected: ${digitConfusion.description}. Reading ${extractedReading} km likely misread from ~${digitConfusion.likelyCorrect} km`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  // Huge jump that's likely a VLM misread (more than 5x proportional max)
  if (kmDifference > proportionalMaxKm * 5) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Impossible km jump: ${kmDifference} km in ${daysSinceLast} day(s) (max expected: ${proportionalMaxKm} km). Likely VLM misread.`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  // Large jump (more than 2x proportional max) - flag for verification
  if (kmDifference > proportionalMaxKm * 2) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Large km increase: ${kmDifference} km in ${daysSinceLast} day(s) - verify if correct`,
      warningLevel: 'high',
      suggestedAction: 'verify',
    };
  }

  // Moderate jump (more than max single trip)
  if (kmDifference > maxSingleTripKm) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Above normal km: ${kmDifference} km since last reading`,
      warningLevel: 'medium',
      suggestedAction: 'verify',
    };
  }

  // All good
  return {
    isValid: true,
    validatedReading: extractedReading,
    originalReading: extractedReading,
    warning: null,
    warningLevel: 'none',
    suggestedAction: 'accept',
  };
}

/**
 * Detect digit confusion patterns in odometer readings
 * Common VLM errors: 1↔6, 2↔3, 7↔1, 8↔0
 */
function detectDigitConfusionValidation(
  extractedStr: string,
  previousStr: string,
  kmDiff: number
): { description: string; likelyCorrect: number } | null {
  // Only check if same length and difference is large
  if (extractedStr.length !== previousStr.length || kmDiff < 5000) {
    return null;
  }

  const confusionMap: Record<string, string[]> = {
    '1': ['6', '7'],
    '6': ['1', '8'],
    '2': ['3', '7'],
    '3': ['2', '8'],
    '7': ['1', '2'],
    '8': ['3', '6', '0'],
    '0': ['8', '6'],
  };

  // Find differing digits
  const diffPositions: { pos: number; extracted: string; previous: string }[] = [];
  for (let i = 0; i < extractedStr.length; i++) {
    if (extractedStr[i] !== previousStr[i]) {
      diffPositions.push({ pos: i, extracted: extractedStr[i], previous: previousStr[i] });
    }
  }

  // If only 1-2 digits differ and they're confusion pairs, likely misread
  if (diffPositions.length >= 1 && diffPositions.length <= 2) {
    const confusedDigits = diffPositions.filter(d =>
      confusionMap[d.previous]?.includes(d.extracted) ||
      confusionMap[d.extracted]?.includes(d.previous)
    );

    if (confusedDigits.length === diffPositions.length) {
      // All differences are confusion pairs - very likely a misread
      const description = confusedDigits
        .map(d => `${d.extracted}↔${d.previous} at position ${d.pos + 1}`)
        .join(', ');

      // Calculate what the reading likely should be
      const correctedStr = extractedStr.split('');
      confusedDigits.forEach(d => {
        correctedStr[d.pos] = d.previous;
      });
      const likelyCorrect = parseInt(correctedStr.join(''), 10);

      return { description, likelyCorrect };
    }
  }

  return null;
}

/**
 * Enhanced odometer extraction with validation
 * Gets previous reading from database and validates the extracted value
 * Now uses calibration data for better accuracy and validation
 */
export async function extractAndValidateOdometerReading(
  base64Image: string,
  vehicleId: string,
  getPreviousReading: () => Promise<number | null>
): Promise<OdometerExtractionResult & { validation: OdometerValidationResult; calibrationUsed?: boolean }> {
  // Try calibration-aware extraction first
  const extractionResult = await extractOdometerWithCalibration(base64Image, vehicleId);

  // Get previous reading for comparison
  const previousReading = await getPreviousReading();

  // Use calibration baseline as fallback for previous reading if available
  const effectivePrevious = previousReading ?? extractionResult.baselineOdometer ?? null;

  // Validate the reading
  const validation = validateOdometerReading(
    extractionResult.reading,
    extractionResult.confidence,
    effectivePrevious,
    {
      // If calibration is available, we can be more strict
      minConfidence: extractionResult.calibrationUsed ? 0.80 : 0.85,
    }
  );

  log.info('FleetVlmService', `ODO validation: extracted=${extractionResult.reading}, previous=${effectivePrevious}, calibration=${extractionResult.calibrationUsed}, action=${validation.suggestedAction}`);

  if (validation.warning) {
    log.warn('FleetVlmService', `ODO warning: ${validation.warning}`);
  }

  return {
    ...extractionResult,
    validation,
    calibrationUsed: extractionResult.calibrationUsed,
  };
}

/**
 * Update calibration VLM learning status
 * Call after successful readings to mark calibration as 'ready'
 */
export async function updateCalibrationLearningStatus(
  calibrationId: string,
  status: 'pending' | 'learning' | 'ready'
): Promise<void> {
  try {
    await sql`
      UPDATE fleet_vehicle_calibration
      SET vlm_learning_status = ${status}
      WHERE id = ${calibrationId}
    `;
    log.info('FleetVlmService', `Updated calibration ${calibrationId} learning status to ${status}`);
  } catch (error) {
    log.error('FleetVlmService', `Failed to update calibration status: ${error}`);
  }
}

/**
 * Calculate odometer discrepancy
 * @param current - Current odometer reading
 * @param previous - Previous odometer reading
 * @param daysSince - Days since last reading
 * @param dailyThreshold - Max expected km per day
 * @returns Discrepancy info or null if no discrepancy
 */
export function checkOdometerDiscrepancy(
  current: number,
  previous: number | null,
  daysSince: number,
  dailyThreshold: number
): { isDiscrepancy: boolean; reason: string | null } {
  if (previous === null) {
    return { isDiscrepancy: false, reason: null };
  }

  const kmSinceLast = current - previous;

  // Check for rollback (impossible - odometer went backwards)
  if (kmSinceLast < 0) {
    return {
      isDiscrepancy: true,
      reason: `Odometer rollback detected: ${current} km is less than previous ${previous} km`,
    };
  }

  // Check for excessive daily km
  const maxExpectedKm = daysSince * dailyThreshold;
  if (kmSinceLast > maxExpectedKm) {
    const avgPerDay = Math.round(kmSinceLast / daysSince);
    return {
      isDiscrepancy: true,
      reason: `Excessive km: ${kmSinceLast} km in ${daysSince} days (${avgPerDay} km/day vs ${dailyThreshold} km/day threshold)`,
    };
  }

  // Check for static odometer (potential tampering)
  if (daysSince >= 7 && kmSinceLast === 0) {
    return {
      isDiscrepancy: true,
      reason: `Static odometer: ${current} km unchanged for ${daysSince} days`,
    };
  }

  return { isDiscrepancy: false, reason: null };
}
