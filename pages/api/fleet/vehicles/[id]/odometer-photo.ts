/**
 * Fleet Vehicle Odometer Photo API
 * POST: Upload and process an odometer photo via VLM
 *
 * This endpoint allows uploading a dashboard/odometer photo outside of the
 * check-in flow. The VLM service extracts the odometer reading, which can
 * then be confirmed and saved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  extractOdometerReading,
  checkOdometerDiscrepancy,
} from '@/modules/fleet/services/fleetVlmService';
import type { FleetOdometerHistoryRow } from '@/modules/fleet/types/check-in.types';
import { rowToOdometerHistory } from '@/modules/fleet/types/check-in.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

// Increase body size limit for image uploads (10MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const DEFAULT_DAILY_KM_THRESHOLD = 500;

interface OdometerPhotoRequest {
  // Base64 encoded image (without data URI prefix)
  imageBase64: string;
  // Whether to automatically save if extraction is successful
  autoSave?: boolean;
}

interface OdometerPhotoResponse {
  success: boolean;
  extraction: {
    reading: number | null;
    confidence: number;
    rawText: string;
  };
  comparison: {
    previousReading: number | null;
    kmSinceLast: number | null;
    daysElapsed: number | null;
    avgKmPerDay: number | null;
    threshold: number;
  } | null;
  discrepancy: {
    isDiscrepancy: boolean;
    reason: string | null;
  } | null;
  saved: boolean;
  savedReading?: {
    id: string;
    reading: number;
    recordedAt: string;
  };
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['POST']);
  }

  try {
    return handlePost(req, res, vehicleId);
  } catch (error) {
    log.error('Fleet odometer photo API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as OdometerPhotoRequest;

  // Validate image data
  if (!body.imageBase64) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Image data is required (imageBase64)');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  const registration = vehicleCheck[0].registration as string;

  log.info('Processing odometer photo', { vehicleId, registration });

  // Extract odometer reading via VLM
  const extraction = await extractOdometerReading(body.imageBase64);

  const response: OdometerPhotoResponse = {
    success: extraction.reading !== null,
    extraction: {
      reading: extraction.reading,
      confidence: extraction.confidence,
      rawText: extraction.rawText,
    },
    comparison: null,
    discrepancy: null,
    saved: false,
  };

  // If extraction failed, return early
  if (extraction.reading === null) {
    response.error = extraction.error || 'Could not extract odometer reading from image';
    return apiResponse.success(res, response);
  }

  // Get previous reading for comparison
  const previousRows = await sql`
    SELECT reading, recorded_at FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as Array<{ reading: number; recorded_at: string }>;

  const previousReading = previousRows[0]?.reading ?? null;
  const previousDate = previousRows[0]?.recorded_at ?? null;

  // Calculate comparison metrics
  const kmSinceLast = previousReading !== null ? extraction.reading - previousReading : null;

  let daysSince = 1;
  if (previousDate) {
    const prev = new Date(previousDate);
    const now = new Date();
    daysSince = Math.max(1, Math.ceil((now.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // Get vehicle threshold or use default
  const thresholdRows = await sql`
    SELECT daily_km_threshold FROM fleet_vehicle_thresholds
    WHERE vehicle_id = ${vehicleId}
  ` as Array<{ daily_km_threshold: number }>;

  const dailyThreshold = thresholdRows[0]?.daily_km_threshold || DEFAULT_DAILY_KM_THRESHOLD;

  // Add comparison data
  response.comparison = {
    previousReading,
    kmSinceLast,
    daysElapsed: previousDate ? daysSince : null,
    avgKmPerDay: kmSinceLast !== null && daysSince > 0 ? Math.round(kmSinceLast / daysSince) : null,
    threshold: dailyThreshold,
  };

  // Check for discrepancy
  const discrepancyResult = checkOdometerDiscrepancy(
    extraction.reading,
    previousReading,
    daysSince,
    dailyThreshold
  );

  response.discrepancy = discrepancyResult;

  // Auto-save if requested and extraction was successful with good confidence
  if (body.autoSave && extraction.reading !== null && extraction.confidence >= 0.7) {
    try {
      const rows = await sql`
        INSERT INTO fleet_odometer_history (
          vehicle_id,
          reading,
          source,
          vlm_confidence,
          previous_reading,
          km_since_last,
          discrepancy_flag,
          discrepancy_reason,
          recorded_at
        ) VALUES (
          ${vehicleId},
          ${extraction.reading},
          'vlm',
          ${extraction.confidence},
          ${previousReading},
          ${kmSinceLast},
          ${discrepancyResult.isDiscrepancy},
          ${discrepancyResult.reason},
          NOW()
        )
        RETURNING *
      ` as FleetOdometerHistoryRow[];

      if (rows[0]) {
        const saved = rowToOdometerHistory(rows[0]);
        response.saved = true;
        response.savedReading = {
          id: saved.id,
          reading: saved.reading,
          recordedAt: saved.recordedAt,
        };

        log.info('Auto-saved VLM odometer reading', {
          vehicleId,
          reading: extraction.reading,
          confidence: extraction.confidence,
        });

        // Create anomaly record if needed
        if (discrepancyResult.isDiscrepancy) {
          await createAnomalyRecord(vehicleId, saved.id, extraction.reading, previousReading, kmSinceLast, discrepancyResult.reason || 'Unknown');
        }
      }
    } catch (saveError) {
      log.error('Failed to auto-save odometer reading', { error: saveError });
      response.error = 'Extraction successful but failed to save';
    }
  }

  return apiResponse.success(res, response);
}

/**
 * Create an anomaly record for flagged odometer readings
 */
async function createAnomalyRecord(
  vehicleId: string,
  historyId: string,
  reading: number,
  previousReading: number | null,
  kmSinceLast: number | null,
  reason: string
) {
  // Determine anomaly type from reason
  let anomalyType = 'excessive';
  let severity = 'warning';

  if (reason.toLowerCase().includes('rollback')) {
    anomalyType = 'rollback';
    severity = 'critical';
  } else if (reason.toLowerCase().includes('static')) {
    anomalyType = 'static';
    severity = 'warning';
  }

  try {
    await sql`
      INSERT INTO fleet_odometer_anomalies (
        vehicle_id,
        odometer_history_id,
        anomaly_type,
        odometer_reading,
        previous_reading,
        odometer_diff,
        severity,
        detected_at
      ) VALUES (
        ${vehicleId},
        ${historyId},
        ${anomalyType},
        ${reading},
        ${previousReading},
        ${kmSinceLast},
        ${severity},
        NOW()
      )
    `;
  } catch (error) {
    log.warn('Failed to create anomaly record', { error });
  }
}

export default withAuth(handler);
