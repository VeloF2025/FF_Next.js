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
  validateOdometerReading,
  OdometerValidationResult,
} from '@/modules/fleet/services/fleetVlmService';
import {
  recordOdometerReading,
  recordFuelLevel,
  getLatestOdometerReading,
} from '@/modules/fleet/services/checkInService';
import type { VlmAnalysisType } from '@/modules/fleet/types/check-in.types';
import { withFleetAuth } from '@/lib/auth/middleware';
import { recordVlmCorrection, recordCorrectExtraction } from '@/services/vlmLearningService';

const sql = neon(process.env.DATABASE_URL!);

interface ProcessVlmRequest {
  photoId: string;
  recordId: string;
  vehicleId: string;
  analysisType: VlmAnalysisType;
  base64Image: string;
  expectedPlate?: string; // For license plate verification
  persistResultsOnly?: boolean; // When true, only save VLM results - skip fuel/odometer history recording
  overrideValue?: string; // User-corrected value (HITL override) to store alongside raw VLM extraction
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
    // Validation fields for odometer
    validation?: OdometerValidationResult;
    // Raw VLM response for debugging
    rawResponse?: string;
  };
  processingTimeMs: number;
}

async function handler(
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
      persistResultsOnly,
      overrideValue,
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

    // Detect preview mode early - preview uses temp IDs that aren't valid UUIDs
    // In preview mode, we process VLM but don't persist to database
    const isPreviewMode = photoId.startsWith('temp-') || recordId === 'pending';

    let result: ProcessVlmResponse['result'];

    switch (analysisType) {
      case 'odometer': {
        const odometerResult = await extractOdometerReading(base64Image);

        // Get previous reading for validation with timestamp
        let previousReading: number | null = null;
        let daysSinceLast = 1;
        if (!isPreviewMode) {
          const prevHistory = await getLatestOdometerReading(vehicleId);
          previousReading = prevHistory?.reading ?? null;
          if (prevHistory?.recordedAt) {
            const prevDate = new Date(prevHistory.recordedAt);
            const now = new Date();
            daysSinceLast = Math.max(1, Math.ceil((now.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)));
          }
        }

        // Validate the reading against previous value with time context
        const validation = validateOdometerReading(
          odometerResult.reading,
          odometerResult.confidence,
          previousReading,
          { daysSinceLast }
        );

        // Include extraction warning in result
        const extractionWarning = odometerResult.warning;

        result = {
          extractedValue: odometerResult.rawText,
          extractedNumeric: odometerResult.reading,
          confidence: odometerResult.confidence,
          error: odometerResult.error || (extractionWarning ? `⚠️ ${extractionWarning}` : undefined),
          validation,
          rawResponse: odometerResult.rawResponse,
        };

        // Log validation warnings
        if (validation.warning) {
          log.warn('FleetVlmApi', `ODO Validation: ${validation.warning} (action: ${validation.suggestedAction})`);
        }
        if (extractionWarning) {
          log.warn('FleetVlmApi', `ODO Extraction warning: ${extractionWarning}`);
        }

        // Only record odometer reading if not in preview mode, not persist-only mode,
        // extraction succeeded, and validation doesn't suggest rejection
        if (!isPreviewMode && !persistResultsOnly && odometerResult.reading !== null) {
          if (validation.suggestedAction === 'reject') {
            log.warn('FleetVlmApi', `ODO rejected by validation: ${validation.warning}`);
            // Write raw VLM response to debug log for diagnosis without SSH (e.g. digit drop issues)
            try { require('fs').appendFileSync('/home/velo/vlm-odometer-debug.log', JSON.stringify({ ts: new Date().toISOString(), vehicleId, reading: odometerResult.reading, rawResponse: odometerResult.rawResponse, warning: validation.warning }) + '\n'); } catch (e) { log.error('FleetVlmApi', 'Failed to write odometer debug log', { error: e }); }
            result.error = validation.warning || 'Reading failed validation';
          } else {
            await recordOdometerReading({
              vehicleId,
              checkRecordId: recordId,
              reading: odometerResult.reading,
              source: 'vlm',
              vlmConfidence: odometerResult.confidence,
              discrepancyFlag: validation.suggestedAction === 'verify',
              discrepancyReason: validation.warning || undefined,
            });
            log.info('FleetVlmApi', `Recorded odometer reading: ${odometerResult.reading} km (validation: ${validation.suggestedAction})`);
            if (validation.suggestedAction === 'verify') { try { require('fs').appendFileSync('/home/velo/vlm-odometer-debug.log', JSON.stringify({ ts: new Date().toISOString(), vehicleId, reading: odometerResult.reading, rawResponse: odometerResult.rawResponse, warning: validation.warning }) + '\n'); } catch (e) { log.error('FleetVlmApi', 'Failed to write odometer debug log', { error: e }); } }
          }
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

        // Only record fuel level if not in preview mode, not persist-only mode, and extraction succeeded
        if (!isPreviewMode && !persistResultsOnly && fuelResult.level !== null) {
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

    // Only store VLM result in database if not in preview mode
    if (!isPreviewMode) {
      await sql`
        INSERT INTO fleet_photo_vlm_results (
          photo_id, analysis_type, extracted_value, extracted_numeric,
          confidence, plate_matches_vehicle, expected_plate,
          vlm_model, raw_response, processing_time_ms, processing_status, error_message,
          override_value
        )
        VALUES (
          ${photoId},
          ${analysisType},
          ${result.extractedValue},
          ${result.extractedNumeric},
          ${result.confidence},
          ${result.plateMatches ?? null},
          ${expectedPlate ?? null},
          ${process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ'},
          ${result.rawResponse ?? null},
          ${processingTimeMs},
          ${result.error ? 'failed' : 'completed'},
          ${result.error ?? null},
          ${overrideValue ?? null}
        )
      `;
    }

    // Record VLM learning metrics (fire-and-forget, never blocks main flow)
    if (!isPreviewMode && !result.error) {
      if (overrideValue && result.extractedValue) {
        // User corrected the VLM reading — record as correction for learning
        recordVlmCorrection({
          module: 'fleet',
          analysisType,
          sourceId: recordId,
          sourceTable: 'fleet_check_records',
          vlmExtractedValue: String(result.extractedNumeric ?? result.extractedValue),
          vlmConfidence: result.confidence,
          vlmModel: process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ',
          correctedValue: overrideValue,
          correctionReason: 'human_override',
        }).catch(e => log.warn('FleetVlmApi', `Learning correction record failed (non-critical): ${e}`));
      } else if (result.confidence >= 0.7) {
        // High-confidence successful extraction — record as correct for metrics
        recordCorrectExtraction('fleet', analysisType, result.confidence)
          .catch(e => log.warn('FleetVlmApi', `Learning metric record failed (non-critical): ${e}`));
      }
    }

    log.info('FleetVlmApi', `${analysisType} processing completed in ${processingTimeMs}ms (preview: ${isPreviewMode})`);

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
    log.error('FleetVlmApi', 'VLM health check failed', { error });
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

export default withFleetAuth(handler);
