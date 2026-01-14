/**
 * Fleet Check-In VLM Photo Processing API
 * Processes photos using VLM for odometer OCR, license plate verification, and fuel gauge reading
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  extractOdometerReading,
  verifyLicensePlate,
  extractFuelLevel,
  checkFleetVlmHealth,
} from '@/modules/fleet/services/fleetVlmService';
import {
  recordOdometerReading,
  recordFuelLevel,
} from '@/modules/fleet/services/checkInService';
import type { VlmAnalysisType } from '@/modules/fleet/types/check-in.types';

const sql = neon(process.env.DATABASE_URL!);

interface ProcessVlmRequest {
  photoId: string;
  recordId: string;
  vehicleId: string;
  analysisType: VlmAnalysisType;
  base64Image: string;
  expectedPlate?: string; // For license plate verification
}

interface ProcessVlmResponse {
  success: boolean;
  analysisType: VlmAnalysisType;
  result: {
    extractedValue: string | null;
    extractedNumeric: number | null;
    confidence: number;
    plateMatches?: boolean;
    description?: string;
    error?: string;
  };
  processingTimeMs: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const {
      photoId,
      recordId,
      vehicleId,
      analysisType,
      base64Image,
      expectedPlate,
    } = req.body as ProcessVlmRequest;

    // Validate required fields
    if (!photoId || !recordId || !vehicleId || !analysisType || !base64Image) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing required fields: photoId, recordId, vehicleId, analysisType, base64Image');
    }

    // Validate analysis type
    const validTypes: VlmAnalysisType[] = ['odometer', 'license_plate', 'fuel_gauge', 'damage'];
    if (!validTypes.includes(analysisType)) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `Invalid analysisType. Must be one of: ${validTypes.join(', ')}`);
    }

    const startTime = Date.now();
    log.info('FleetVlmApi', `Processing ${analysisType} for photo ${photoId}`);

    let result: ProcessVlmResponse['result'];

    switch (analysisType) {
      case 'odometer': {
        const odometerResult = await extractOdometerReading(base64Image);
        result = {
          extractedValue: odometerResult.rawText,
          extractedNumeric: odometerResult.reading,
          confidence: odometerResult.confidence,
          error: odometerResult.error,
        };

        // Record odometer reading if extraction succeeded
        if (odometerResult.reading !== null) {
          await recordOdometerReading({
            vehicleId,
            checkRecordId: recordId,
            reading: odometerResult.reading,
            source: 'vlm',
            vlmConfidence: odometerResult.confidence,
          });
          log.info('FleetVlmApi', `Recorded odometer reading: ${odometerResult.reading} km`);
        }
        break;
      }

      case 'license_plate': {
        if (!expectedPlate) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'expectedPlate is required for license_plate analysis');
        }
        const plateResult = await verifyLicensePlate(base64Image, expectedPlate);
        result = {
          extractedValue: plateResult.plateText,
          extractedNumeric: null,
          confidence: plateResult.confidence,
          plateMatches: plateResult.matches,
          error: plateResult.error,
        };
        break;
      }

      case 'fuel_gauge': {
        const fuelResult = await extractFuelLevel(base64Image);
        result = {
          extractedValue: fuelResult.description,
          extractedNumeric: fuelResult.level,
          confidence: fuelResult.confidence,
          description: fuelResult.description,
          error: fuelResult.error,
        };

        // Record fuel level if extraction succeeded
        if (fuelResult.level !== null) {
          await recordFuelLevel({
            vehicleId,
            checkRecordId: recordId,
            fuelLevel: fuelResult.level,
            source: 'vlm',
            vlmConfidence: fuelResult.confidence,
          });
          log.info('FleetVlmApi', `Recorded fuel level: ${fuelResult.level}%`);
        }
        break;
      }

      case 'damage': {
        // Damage photos don't need VLM analysis - they're documentation
        result = {
          extractedValue: 'Damage photo recorded',
          extractedNumeric: null,
          confidence: 1.0,
        };
        break;
      }

      default:
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, `Unsupported analysis type: ${analysisType}`);
    }

    const processingTimeMs = Date.now() - startTime;

    // Store VLM result in database
    await sql`
      INSERT INTO fleet_photo_vlm_results (
        photo_id, analysis_type, extracted_value, extracted_numeric,
        confidence, plate_matches_vehicle, expected_plate,
        vlm_model, processing_time_ms, processing_status, error_message
      )
      VALUES (
        ${photoId},
        ${analysisType},
        ${result.extractedValue},
        ${result.extractedNumeric},
        ${result.confidence},
        ${result.plateMatches ?? null},
        ${expectedPlate ?? null},
        ${'Qwen/Qwen3-VL-8B-Instruct'},
        ${processingTimeMs},
        ${result.error ? 'failed' : 'completed'},
        ${result.error ?? null}
      )
    `;

    log.info('FleetVlmApi', `${analysisType} processing completed in ${processingTimeMs}ms`);

    return apiResponse.success(res, {
      success: !result.error,
      analysisType,
      result,
      processingTimeMs,
    });
  } catch (error) {
    log.error('FleetVlmApi', `VLM processing failed: ${error}`);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Health check endpoint for VLM service
 */
export async function checkVlmHealthEndpoint(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const isHealthy = await checkFleetVlmHealth();
    return apiResponse.success(res, { healthy: isHealthy });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Allow larger bodies for base64 images
    },
  },
};
