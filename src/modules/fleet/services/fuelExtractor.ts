/**
 * Fuel Extractor
 *
 * Purpose: Extract fuel gauge levels from dashboard photos and parse fuel
 * receipt photos. Includes calibration-aware validation and retry logic.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import {
  FuelGaugeExtractionResult,
  FuelReceiptExtractionResult,
} from '../types/check-in.types';
import { callVlmApi, parseVlmJson, getVehicleCalibration } from './fleetVlmClient';

// ============================================================================
// PROMPTS
// ============================================================================

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

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map categorical fuel level to percentage.
 */
function categoryToPercent(category: string | null): number | null {
  if (!category) return null;
  const normalized = category.toLowerCase().trim();
  const mapping: Record<string, number> = {
    empty: 0,
    '1/4': 25,
    '1/2': 50,
    '3/4': 75,
    full: 100,
  };
  return mapping[normalized] ?? null;
}

// ============================================================================
// FUEL GAUGE
// ============================================================================

/**
 * Extract fuel gauge level from dashboard photo.
 *
 * @param base64Image - Base64-encoded image of fuel gauge
 * @returns Fuel level result (0-100 percentage)
 */
export async function extractFuelLevel(
  base64Image: string
): Promise<FuelGaugeExtractionResult> {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.info(
        'FleetVlmService',
        `Extracting fuel gauge level (attempt ${attempt}/${MAX_RETRIES})...`
      );

      const content = await callVlmApi(
        base64Image,
        FUEL_GAUGE_PROMPT,
        'fuel_gauge'
      );
      const result = parseVlmJson<{
        level_category?: string | null;
        level: number | null;
        confidence: number;
        description: string;
      }>(content);

      let level = result.level;
      if (result.level_category) {
        const categoryLevel = categoryToPercent(result.level_category);
        if (categoryLevel !== null) {
          log.info(
            'FleetVlmService',
            `Using categorical level: ${result.level_category} -> ${categoryLevel}%`
          );
          level = categoryLevel;
        }
      }

      if (level !== null) {
        level = Math.max(0, Math.min(100, level));
      }

      if (level !== null && (result.confidence || 0) < 0.4) {
        log.warn(
          'FleetVlmService',
          `Low confidence fuel gauge read: ${level}% @ ${result.confidence} conf — attempt ${attempt}`
        );
      }

      return {
        level,
        confidence: result.confidence || 0,
        description: result.description || '',
      };
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : 'Unknown error';
      log.error(
        'FleetVlmService',
        `Fuel gauge extraction attempt ${attempt} failed: ${errMsg}`
      );

      const isRetryable =
        errMsg.includes('timeout') ||
        errMsg.includes('PARSE_ERROR') ||
        errMsg.includes('NO_CONTENT');
      if (attempt < MAX_RETRIES && isRetryable) {
        log.info(
          'FleetVlmService',
          `Retrying fuel gauge extraction (${attempt}/${MAX_RETRIES})...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 * attempt)
        );
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

  // Fallback (unreachable but TypeScript requires it)
  return {
    level: null,
    confidence: 0,
    description: 'Extraction failed after retries',
    error: 'Max retries exceeded',
  };
}

/**
 * Extract fuel level with calibration context.
 * Uses calibration baseline to validate large fuel changes.
 *
 * @param base64Image - Current dashboard photo (base64)
 * @param vehicleId - Vehicle UUID to fetch calibration data
 * @param previousFuelLevel - Previous fuel level (0-100) for comparison
 * @returns Enhanced fuel extraction with calibration awareness
 */
export async function extractFuelLevelWithCalibration(
  base64Image: string,
  vehicleId: string,
  previousFuelLevel?: number | null
): Promise<
  FuelGaugeExtractionResult & {
    calibrationUsed: boolean;
    baselineFuelLevel?: number;
  }
> {
  try {
    const result = await extractFuelLevel(base64Image);
    const calibration = await getVehicleCalibration(vehicleId);

    if (!calibration) {
      return { ...result, calibrationUsed: false };
    }

    log.info(
      'FleetVlmService',
      `Fuel calibration context: baseline=${calibration.baselineFuelLevel}%`
    );

    const prevLevel =
      previousFuelLevel ?? calibration.baselineFuelLevel;
    if (result.level !== null && prevLevel !== null) {
      const fuelChange = result.level - prevLevel;

      if (fuelChange > 60 && prevLevel > 30) {
        log.warn(
          'FleetVlmService',
          `Suspicious fuel increase: ${prevLevel}% -> ${result.level}% (+${fuelChange}%)`
        );
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
    log.error(
      'FleetVlmService',
      `Calibration-aware fuel extraction failed: ${error}`
    );
    const fallback = await extractFuelLevel(base64Image);
    return { ...fallback, calibrationUsed: false };
  }
}

// ============================================================================
// FUEL RECEIPT
// ============================================================================

/**
 * Extract fuel purchase details from receipt photo.
 *
 * @param base64Image - Base64-encoded image of fuel receipt
 * @returns Fuel receipt extraction result with amount, litres, date, station info
 */
export async function extractFuelReceipt(
  base64Image: string
): Promise<FuelReceiptExtractionResult> {
  try {
    log.info('FleetVlmService', 'Extracting fuel receipt data...');

    const content = await callVlmApi(
      base64Image,
      FUEL_RECEIPT_PROMPT,
      'fuel_receipt'
    );
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

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Get a human-readable fuel level description from a percentage value.
 */
export function getFuelLevelDescription(level: number): string {
  if (level <= 10) return 'Empty';
  if (level <= 30) return 'Quarter';
  if (level <= 55) return 'Half';
  if (level <= 80) return 'Three-quarters';
  return 'Full';
}
