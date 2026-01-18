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
import {
  OdometerExtractionResult,
  LicensePlateExtractionResult,
  FuelGaugeExtractionResult,
  FuelReceiptExtractionResult,
  LicenseDiskExtractionResult,
  VlmAnalysisType,
} from '../types/check-in.types';

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

    // Skip resizing if image is already small enough
    if (width <= VLM_MAX_WIDTH && height <= VLM_MAX_HEIGHT) {
      log.info('FleetVlmService', `Image ${width}x${height} already within limits, skipping resize`);
      return base64Image;
    }

    log.info('FleetVlmService', `Resizing image from ${width}x${height} to max ${VLM_MAX_WIDTH}x${VLM_MAX_HEIGHT}`);

    const resizedBuffer = await sharp(inputBuffer)
      .resize(VLM_MAX_WIDTH, VLM_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: VLM_JPEG_QUALITY })
      .toBuffer();

    const resizedBase64 = resizedBuffer.toString('base64');

    // Log size reduction
    const originalSize = Math.round(inputBuffer.length / 1024);
    const resizedSize = Math.round(resizedBuffer.length / 1024);
    log.info('FleetVlmService', `Image resized: ${originalSize}KB -> ${resizedSize}KB (${Math.round(resizedSize/originalSize*100)}%)`);

    return resizedBase64;
  } catch (error) {
    log.error('FleetVlmService', `Image resize failed: ${error}`);
    // Return original if resize fails - better than no result
    return base64Image;
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
// VLM Prompts
// ============================================================================

const ODOMETER_PROMPT = `You are analyzing a vehicle dashboard/odometer photo.

TASK: Extract the odometer/mileage reading from this photo.

INSTRUCTIONS:
1. Look for the odometer display (digital or analog)
2. Read the total kilometers/miles shown
3. Ignore trip meters - we want the TOTAL odometer reading
4. If there are multiple numbers, identify which one is the main odometer

RESPONSE FORMAT (JSON only, no other text):
{
  "reading": 123456,
  "confidence": 0.95,
  "raw_text": "123,456 km"
}

If the odometer is not visible or unreadable:
{
  "reading": null,
  "confidence": 0,
  "raw_text": "unreadable"
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
- Registration number (e.g., "GP 456-789")
- VIN (Vehicle Identification Number) - 17 characters
- Engine number
- Make (manufacturer)
- Description (model/type)
- Year of first registration
- Tare (unladen mass in kg)
- GVM (Gross Vehicle Mass in kg)
- Licence expiry date
- Colour (sometimes listed)

INSTRUCTIONS:
1. Look for all text fields on the licence disk
2. Extract each piece of information carefully
3. VIN is typically 17 characters long
4. Registration follows South African format (e.g., "XX 000-000 GP" or "XX 000 GP")
5. If you can see a date, extract it in YYYY-MM-DD format
6. If a field is not visible or unreadable, use null

RESPONSE FORMAT (JSON only, no other text):
{
  "registration": "GP 456-789",
  "vin": "AHTBB3CD102123456",
  "engine_number": "1KD1234567",
  "make": "TOYOTA",
  "description": "HILUX 2.4 GD-6",
  "year": 2023,
  "tare": 1900,
  "gvm": 3100,
  "license_expiry": "2025-06-30",
  "color": "WHITE",
  "confidence": 0.85,
  "raw_text": "all visible text from the disk"
}

If the licence disk is not clearly visible or unreadable:
{
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
 * Extract odometer reading from dashboard photo
 * @param base64Image - Base64-encoded image of the dashboard/odometer
 * @returns Odometer reading result
 */
export async function extractOdometerReading(
  base64Image: string
): Promise<OdometerExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting odometer reading...');

    const content = await callVlmApi(base64Image, ODOMETER_PROMPT, 'odometer');
    const result = parseVlmJson<{
      reading: number | null;
      confidence: number;
      raw_text: string;
    }>(content);

    return {
      reading: result.reading,
      confidence: result.confidence || 0,
      rawText: result.raw_text || '',
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
  try {
    log.info('FleetVlmService', 'Extracting fuel gauge level...');

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

    return {
      level,
      confidence: result.confidence || 0,
      description: result.description || '',
    };
  } catch (error) {
    log.error('FleetVlmService', `Fuel gauge extraction failed: ${error}`);
    return {
      level: null,
      confidence: 0,
      description: 'Extraction failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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
    let vin = result.vin;
    if (vin && vin.length !== 17) {
      log.warn('FleetVlmService', `VIN length invalid (${vin.length}), expected 17 characters`);
      // Keep it but note the issue
    }

    return {
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
 */
export function validateOdometerReading(
  extractedReading: number | null,
  confidence: number,
  previousReading: number | null,
  options?: {
    maxDailyKm?: number;      // Max expected km per day (default 500)
    maxSingleTripKm?: number; // Max km for a single check-in difference (default 1000)
    minConfidence?: number;   // Min VLM confidence to auto-accept (default 0.85)
  }
): OdometerValidationResult {
  const {
    maxDailyKm = 500,
    maxSingleTripKm = 1000,
    minConfidence = 0.85,
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

  // Huge jump that's likely a VLM misread (more than 10x expected daily km)
  if (kmDifference > maxDailyKm * 10) {
    // Check if digits might have been transposed/misread
    const extractedStr = extractedReading.toString();
    const previousStr = previousReading.toString();

    // If same length and similar pattern, likely a digit misread
    if (extractedStr.length === previousStr.length) {
      let diffDigits = 0;
      for (let i = 0; i < extractedStr.length; i++) {
        if (extractedStr[i] !== previousStr[i]) diffDigits++;
      }

      if (diffDigits <= 2) {
        return {
          isValid: false,
          validatedReading: null,
          originalReading: extractedReading,
          warning: `Suspicious reading: ${extractedReading} km differs from previous ${previousReading} km by ${kmDifference} km - possible VLM digit misread`,
          warningLevel: 'high',
          suggestedAction: 'reject',
        };
      }
    }

    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Large km increase: ${kmDifference} km since last reading - verify if correct`,
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
 * Enhanced odometer extraction with validation
 * Gets previous reading from database and validates the extracted value
 */
export async function extractAndValidateOdometerReading(
  base64Image: string,
  vehicleId: string,
  getPreviousReading: () => Promise<number | null>
): Promise<OdometerExtractionResult & { validation: OdometerValidationResult }> {
  // Extract reading using VLM
  const extractionResult = await extractOdometerReading(base64Image);

  // Get previous reading for comparison
  const previousReading = await getPreviousReading();

  // Validate the reading
  const validation = validateOdometerReading(
    extractionResult.reading,
    extractionResult.confidence,
    previousReading
  );

  log.info('FleetVlmService', `ODO validation: extracted=${extractionResult.reading}, previous=${previousReading}, action=${validation.suggestedAction}`);

  if (validation.warning) {
    log.warn('FleetVlmService', `ODO warning: ${validation.warning}`);
  }

  return {
    ...extractionResult,
    validation,
  };
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
