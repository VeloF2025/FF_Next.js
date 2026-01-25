/**
 * API Route: /api/activate/extract-data
 *
 * Purpose: Phase 3 of QA Wizard - Extract technical data from photos using VLM
 * Method: POST
 *
 * Extracts:
 * - Power meter dBm reading (Step 7)
 * - ONT serial from back (Step 6)
 * - ONT serial and DR number from front label (Step 9)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  runFullExtraction,
  serialsMatch,
  drNumbersMatch,
  type FullExtractionResult,
} from '@/modules/activate/services/vlmExtractionService';
import {
  validatePowerMeter,
  validateSerialCrossReference,
  type DrValidationData,
  type PowerMeterResult,
  type SerialValidationResult,
} from '@/modules/activate/services/qaAutoFailService';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface ExtractDataRequest {
  dropNumber: string;
  /** Force re-extraction even if already done */
  force?: boolean;
}

interface ExtractDataResponse {
  drNumber: string;
  extraction: FullExtractionResult;
  validation: {
    powerMeter: PowerMeterResult;
    serialCrossReference: SerialValidationResult;
  };
  summary: {
    powerMeterStatus: string;
    serialStatus: string;
    drNumberStatus: string;
    canProceed: boolean;
  };
  /** Whether confirmation mode was used (OneMap serial available) */
  usedConfirmationMode: boolean;
  processingTimeMs: number;
}

/**
 * POST /api/activate/extract-data
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, force = false } = req.body as ExtractDataRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('ExtractData', `Starting data extraction for ${dropNumber}`, { force });

    // Get categorized photos and VLM results from unified table (after migration 127)
    const reviewResult = await pool.query(
      `SELECT
         drop_number as dr_number,
         photos_metadata::text as photos,
         vlm_categorization_results::text as vlm_categorization,
         ont_serial_scanned as onemap_ont_serial,
         ups_serial_scanned as onemap_ups_serial,
         vlm_power_meter_dbm,
         vlm_ont_serial_step6,
         vlm_ont_serial_step9,
         vlm_dr_number_step9
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1
       LIMIT 1`,
      [dropNumber]
    );

    if (reviewResult.rows.length === 0) {
      return apiResponse.notFound(res, 'DR review', dropNumber);
    }

    const review = reviewResult.rows[0];

    // Check if extraction already done and not forcing
    if (
      !force &&
      (review.vlm_power_meter_dbm !== null ||
        review.vlm_ont_serial_step6 !== null ||
        review.vlm_ont_serial_step9 !== null)
    ) {
      log.info('ExtractData', `Extraction already done for ${dropNumber}, returning cached results`);

      // Return cached results
      const cachedValidation = buildValidationFromCached(review, dropNumber);

      return apiResponse.success(res, {
        drNumber: dropNumber,
        extraction: {
          drNumber: dropNumber,
          powerMeter: review.vlm_power_meter_dbm !== null
            ? { success: true, value: review.vlm_power_meter_dbm, unit: 'dBm', confidence: 1, rawText: null }
            : null,
          ontSerialStep6: review.vlm_ont_serial_step6
            ? { success: true, serial: review.vlm_ont_serial_step6, confidence: 1, location: 'back', rawText: null }
            : null,
          step9: review.vlm_ont_serial_step9 || review.vlm_dr_number_step9
            ? {
                ontSerial: review.vlm_ont_serial_step9
                  ? { success: true, serial: review.vlm_ont_serial_step9, confidence: 1, location: 'front_label', rawText: null }
                  : { success: false, serial: null, confidence: 0, location: 'front_label', rawText: null },
                drNumber: review.vlm_dr_number_step9
                  ? { success: true, drNumber: review.vlm_dr_number_step9, confidence: 1, rawText: null }
                  : { success: false, drNumber: null, confidence: 0, rawText: null },
                greenLightsVisible: true,
                processingTimeMs: 0,
              }
            : null,
          usedConfirmationMode: !!review.onemap_ont_serial, // Was confirmation mode used
          totalProcessingTimeMs: 0,
        },
        validation: cachedValidation.validation,
        summary: cachedValidation.summary,
        usedConfirmationMode: !!review.onemap_ont_serial,
        processingTimeMs: Date.now() - startTime,
        cached: true,
      });
    }

    // Parse photos to find URLs for Step 6, 7, 9
    let photos: Array<{ filename: string; url?: string; step?: number }> = [];
    try {
      const parsedPhotos = review.photos ? JSON.parse(review.photos) : [];
      const parsedCategorization = review.vlm_categorization ? JSON.parse(review.vlm_categorization) : [];

      // Merge photos with categorization
      photos = parsedPhotos.map((p: { filename: string; url?: string }) => {
        const cat = parsedCategorization.find(
          (c: { photo_filename: string; vlm_predicted_step?: number; human_override_step?: number }) =>
            c.photo_filename === p.filename
        );
        return {
          filename: p.filename,
          url: p.url || `/api/activate/photo/${dropNumber}/${p.filename}`,
          step: cat?.human_override_step ?? cat?.vlm_predicted_step ?? null,
        };
      });
    } catch (e) {
      log.warn('ExtractData', `Failed to parse photos for ${dropNumber}: ${e}`);
    }

    // Find ALL photos for each extraction step - VLM will try each to find best result
    const step6Photos = photos.filter((p) => p.step === 6);
    const step7Photos = photos.filter((p) => p.step === 7);
    const step9Photos = photos.filter((p) => p.step === 9);

    // Use full OneMap URLs for extraction (relative URLs don't work in server context)
    const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';
    const makeOneMapUrl = (filename: string) => `${ONEMAP_HOST}/api/photo/${dropNumber}/${filename}`;

    log.info('ExtractData', `Found photos: Step6=${step6Photos.length}, Step7=${step7Photos.length}, Step9=${step9Photos.length}`);

    // Run VLM extraction with multiple photos per step
    // SMART MODE: If OneMap has serial, use CONFIRMATION mode (more accurate)
    // Otherwise use EXTRACTION mode (fallback)
    const onemapOntSerial = review.onemap_ont_serial;
    log.info('ExtractData', onemapOntSerial
      ? `Using CONFIRMATION mode with OneMap serial: ${onemapOntSerial}`
      : 'Using EXTRACTION mode (no OneMap serial)');

    const extraction = await runFullExtraction(
      dropNumber,
      {
        step6Urls: step6Photos.length > 0 ? step6Photos.map(p => makeOneMapUrl(p.filename)) : undefined,
        step7Urls: step7Photos.length > 0 ? step7Photos.map(p => makeOneMapUrl(p.filename)) : undefined,
        step9Urls: step9Photos.length > 0 ? step9Photos.map(p => makeOneMapUrl(p.filename)) : undefined,
      },
      {
        // Pass OneMap serial for confirmation mode (when available)
        expectedOntSerial: onemapOntSerial,
      }
    );

    // Build validation data
    const validationData: DrValidationData = {
      drNumber: dropNumber,
      photoCount: photos.length,
      photos: photos.map((p) => ({ filename: p.filename, step: p.step ?? null })),
      ontSerial: review.onemap_ont_serial,
      upsSerial: review.onemap_ups_serial,
      powerMeterDbm: extraction.powerMeter?.value ?? null,
      vlmOntSerialStep6: extraction.ontSerialStep6?.serial ?? null,
      vlmOntSerialStep9: extraction.step9?.ontSerial.serial ?? null,
      vlmDrNumberStep9: extraction.step9?.drNumber.drNumber ?? null,
    };

    // Run validations
    const powerMeterResult = validatePowerMeter(validationData.powerMeterDbm);
    const serialResult = validateSerialCrossReference(validationData);

    // Build summary
    const summary = buildSummary(powerMeterResult, serialResult, validationData);

    // Update database with extraction results
    const serialValidationDetails = JSON.stringify({
      onemapSerial: serialResult.onemapSerial,
      step6Serial: serialResult.step6Serial,
      step9Serial: serialResult.step9Serial,
      step9DrNumber: serialResult.step9DrNumber,
      ontMatch: serialResult.ontMatch,
      drMatch: serialResult.drMatch,
    });

    // Update extraction results directly in unified table (after migration 127)
    await pool.query(
      `UPDATE dr_photo_unified_reviews SET
         vlm_power_meter_dbm = $1,
         vlm_power_meter_status = $2,
         vlm_ont_serial_step6 = $3,
         vlm_ont_serial_step9 = $4,
         vlm_dr_number_step9 = $5,
         serial_validation_status = $6,
         serial_validation_details = $7,
         serial_extraction_method_step6 = $8,
         serial_extraction_method_step9 = $9,
         data_validation_completed = true,
         data_validation_completed_at = NOW(),
         qa_phase = 'final_decision',
         onemap_ont_serial = COALESCE($10, onemap_ont_serial),
         onemap_ups_serial = COALESCE($11, onemap_ups_serial),
         overall_status = 'PASS',
         updated_at = NOW()
       WHERE drop_number = $12`,
      [
        extraction.powerMeter?.value ?? null,
        powerMeterResult.status,
        extraction.ontSerialStep6?.serial ?? null,
        extraction.step9?.ontSerial.serial ?? null,
        extraction.step9?.drNumber.drNumber ?? null,
        serialResult.status,
        serialValidationDetails,
        extraction.ontSerialStep6?.extractionMethod ?? 'vlm',
        extraction.step9?.ontSerial.extractionMethod ?? 'vlm',
        review.onemap_ont_serial ?? null,
        review.onemap_ups_serial ?? null,
        dropNumber,
      ]
    );

    const processingTimeMs = Date.now() - startTime;

    log.info('ExtractData', `Data extraction complete for ${dropNumber}`, {
      processingTimeMs,
      powerMeter: powerMeterResult.status,
      serialStatus: serialResult.status,
    });

    const response: ExtractDataResponse = {
      drNumber: dropNumber,
      extraction,
      validation: {
        powerMeter: powerMeterResult,
        serialCrossReference: serialResult,
      },
      summary,
      usedConfirmationMode: extraction.usedConfirmationMode,
      processingTimeMs,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('ExtractData', 'Error extracting data', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Build validation from cached DB values
 */
function buildValidationFromCached(
  review: {
    vlm_power_meter_dbm: number | null;
    vlm_ont_serial_step6: string | null;
    vlm_ont_serial_step9: string | null;
    vlm_dr_number_step9: string | null;
    onemap_ont_serial: string | null;
    onemap_ups_serial: string | null;
    dr_number: string;
  },
  dropNumber: string
) {
  const validationData: DrValidationData = {
    drNumber: dropNumber,
    photoCount: 0,
    photos: [],
    ontSerial: review.onemap_ont_serial,
    upsSerial: review.onemap_ups_serial,
    powerMeterDbm: review.vlm_power_meter_dbm,
    vlmOntSerialStep6: review.vlm_ont_serial_step6,
    vlmOntSerialStep9: review.vlm_ont_serial_step9,
    vlmDrNumberStep9: review.vlm_dr_number_step9,
  };

  const powerMeterResult = validatePowerMeter(validationData.powerMeterDbm);
  const serialResult = validateSerialCrossReference(validationData);
  const summary = buildSummary(powerMeterResult, serialResult, validationData);

  return { validation: { powerMeter: powerMeterResult, serialCrossReference: serialResult }, summary };
}

/**
 * Build human-readable summary
 */
function buildSummary(
  powerMeter: PowerMeterResult,
  serial: SerialValidationResult,
  data: DrValidationData
): ExtractDataResponse['summary'] {
  // Power meter status
  let powerMeterStatus: string;
  if (powerMeter.status === 'pass') {
    powerMeterStatus = `✅ ${powerMeter.value} dBm (in range -18 to -24)`;
  } else if (powerMeter.status === 'fail_high') {
    powerMeterStatus = `❌ ${powerMeter.value} dBm (too high, > -18)`;
  } else if (powerMeter.status === 'fail_low') {
    powerMeterStatus = `❌ ${powerMeter.value} dBm (too low, < -24)`;
  } else if (powerMeter.status === 'pending') {
    powerMeterStatus = '⏳ Not yet extracted';
  } else {
    powerMeterStatus = '🔧 Manual entry needed';
  }

  // Serial status
  let serialStatus: string;
  if (serial.status === 'match') {
    serialStatus = `✅ 3-way match: ${serial.onemapSerial}`;
  } else if (serial.status === 'mismatch') {
    serialStatus = `❌ Mismatch: ${serial.details}`;
  } else if (serial.status === 'pending') {
    serialStatus = '⏳ Not yet extracted';
  } else {
    serialStatus = '🔧 Partial match - review needed';
  }

  // DR number status
  let drNumberStatus: string;
  if (serial.drMatch) {
    drNumberStatus = `✅ Label matches ${data.drNumber}`;
  } else if (serial.step9DrNumber) {
    drNumberStatus = `❌ Label shows ${serial.step9DrNumber}, expected ${data.drNumber}`;
  } else {
    drNumberStatus = '⏳ Not yet extracted';
  }

  // Can proceed?
  const canProceed =
    powerMeter.status === 'pass' && serial.status === 'match' && serial.drMatch;

  return {
    powerMeterStatus,
    serialStatus,
    drNumberStatus,
    canProceed,
  };
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
