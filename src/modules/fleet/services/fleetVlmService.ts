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
import {
  OdometerExtractionResult,
  LicensePlateExtractionResult,
  FuelGaugeExtractionResult,
  VlmAnalysisType,
} from '../types/check-in.types';

// VLM API configuration
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.FLEET_VLM_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 60000; // 1 minute for single image

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

const FUEL_GAUGE_PROMPT = `You are analyzing a vehicle dashboard fuel gauge photo.

TASK: Estimate the fuel level from this photo.

INSTRUCTIONS:
1. Look for the fuel gauge indicator
2. Estimate the fuel level as a percentage (0-100)
3. Use these guidelines:
   - E (Empty) = 0-10%
   - 1/4 = 20-30%
   - 1/2 (Half) = 45-55%
   - 3/4 = 70-80%
   - F (Full) = 90-100%
4. Consider the needle position relative to the gauge markings

RESPONSE FORMAT (JSON only, no other text):
{
  "level": 75,
  "confidence": 0.85,
  "description": "Three-quarters full"
}

If fuel gauge not visible:
{
  "level": null,
  "confidence": 0,
  "description": "Not visible"
}`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Call VLM API with a single image and prompt
 */
async function callVlmApi(
  base64Image: string,
  prompt: string,
  analysisType: VlmAnalysisType
): Promise<string> {
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
              url: `data:image/jpeg;base64,${base64Image}`,
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
      level: number | null;
      confidence: number;
      description: string;
    }>(content);

    // Ensure level is within 0-100 range
    let level = result.level;
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
): Promise<OdometerExtractionResult | LicensePlateExtractionResult | FuelGaugeExtractionResult | null> {
  switch (analysisType) {
    case 'odometer':
      return extractOdometerReading(base64Image);
    case 'license_plate':
      return verifyLicensePlate(base64Image, expectedPlate || '');
    case 'fuel_gauge':
      return extractFuelLevel(base64Image);
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
