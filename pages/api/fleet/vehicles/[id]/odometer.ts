/**
 * Fleet Vehicle Odometer API
 * GET: List odometer history for a vehicle
 * POST: Add a manual odometer reading
 * PATCH: Admin correction of an existing reading
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  OdometerHistory,
  FleetOdometerHistoryRow,
} from '@/modules/fleet/types/check-in.types';
import { rowToOdometerHistory } from '@/modules/fleet/types/check-in.types';
import { checkOdometerDiscrepancy } from '@/modules/fleet/services/fleetVlmService';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

// Default threshold: 500km per day
const DEFAULT_DAILY_KM_THRESHOLD = 500;

interface CreateOdometerReadingRequest {
  reading: number;
  source?: 'manual' | 'vlm';
  vlmConfidence?: number;
  notes?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res, vehicleId);
      case 'POST':
        return handlePost(req, res, vehicleId);
      case 'PATCH':
        return handlePatch(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST', 'PATCH']);
    }
  } catch (error) {
    log.error('Fleet odometer API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { limit = '50', offset = '0', latest } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offsetNum = parseInt(offset as string, 10);

  // If latest=true, only return the most recent reading
  if (latest === 'true') {
    const rows = await sql`
      SELECT id, vehicle_id, check_record_id, reading, source, vlm_confidence,
             previous_reading, km_since_last, discrepancy_flag, discrepancy_reason,
             recorded_at, created_at
      FROM fleet_odometer_history
      WHERE vehicle_id = ${vehicleId}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as FleetOdometerHistoryRow[];

    if (rows.length === 0) {
      return apiResponse.success(res, null);
    }

    return apiResponse.success(res, rowToOdometerHistory(rows[0]));
  }

  // Get paginated history
  const rows = await sql`
    SELECT id, vehicle_id, check_record_id, reading, source, vlm_confidence,
           previous_reading, km_since_last, discrepancy_flag, discrepancy_reason,
           recorded_at, created_at
    FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT ${limitNum} OFFSET ${offsetNum}
  ` as FleetOdometerHistoryRow[];

  // Get total count
  const countResult = await sql`
    SELECT COUNT(*) as total FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
  ` as Array<{ total: string }>;

  const total = parseInt(countResult[0]?.total || '0', 10);
  const history: OdometerHistory[] = rows.map(rowToOdometerHistory);

  return apiResponse.paginated(res, history, {
    page: Math.floor(offsetNum / limitNum) + 1,
    pageSize: limitNum,
    total,
  });
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as CreateOdometerReadingRequest;

  // Validate required fields
  if (body.reading === undefined || body.reading === null) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Odometer reading is required');
  }

  if (body.reading < 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Odometer reading cannot be negative');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Get previous reading
  const previousRows = await sql`
    SELECT reading, recorded_at FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as Array<{ reading: number; recorded_at: string }>;

  const previousReading = previousRows[0]?.reading ?? null;
  const previousDate = previousRows[0]?.recorded_at ?? null;

  // Calculate km since last
  const kmSinceLast = previousReading !== null ? body.reading - previousReading : null;

  // Calculate days since last reading
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

  // Check for discrepancy
  const discrepancyResult = checkOdometerDiscrepancy(
    body.reading,
    previousReading,
    daysSince,
    dailyThreshold
  );

  const source = body.source || 'manual';

  // Insert new reading
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
      ${body.reading},
      ${source},
      ${body.vlmConfidence || null},
      ${previousReading},
      ${kmSinceLast},
      ${discrepancyResult.isDiscrepancy},
      ${discrepancyResult.reason},
      NOW()
    )
    RETURNING id, vehicle_id, check_record_id, reading, source, vlm_confidence,
              previous_reading, km_since_last, discrepancy_flag, discrepancy_reason,
              recorded_at, created_at
  ` as FleetOdometerHistoryRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create odometer reading');
  }

  const reading = rowToOdometerHistory(rows[0]);

  log.info('Created odometer reading', {
    vehicleId,
    reading: body.reading,
    source,
    kmSinceLast,
    discrepancy: discrepancyResult.isDiscrepancy,
  });

  // If there's a discrepancy, also log an anomaly record
  if (discrepancyResult.isDiscrepancy) {
    try {
      await createAnomalyRecord(vehicleId, reading, discrepancyResult.reason || 'Unknown');
    } catch (anomalyError) {
      // Log but don't fail the request
      log.warn('Failed to create anomaly record', { error: anomalyError });
    }
  }

  return apiResponse.created(res, {
    ...reading,
    comparison: {
      previousReading,
      kmSinceLast,
      daysElapsed: daysSince,
      avgKmPerDay: kmSinceLast !== null && daysSince > 0 ? Math.round(kmSinceLast / daysSince) : null,
      threshold: dailyThreshold,
    },
    discrepancy: discrepancyResult,
  });
}

/**
 * PATCH: Admin correction of an existing odometer reading
 */
async function handlePatch(req: NextApiRequest, res: NextApiResponse, vehicleId: string) {
  const { recordId } = req.query;
  const { reading: newReading } = req.body;

  if (!recordId || typeof recordId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'recordId query parameter is required');
  }
  if (newReading === undefined || newReading === null || newReading < 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Valid reading is required');
  }

  const existing = await sql`
    SELECT id, reading, previous_reading, recorded_at FROM fleet_odometer_history
    WHERE id = ${recordId} AND vehicle_id = ${vehicleId}
  ` as Array<{ id: string; reading: number; previous_reading: number | null; recorded_at: string }>;

  if (existing.length === 0) return apiResponse.notFound(res, 'Odometer reading', recordId);

  const oldReading = existing[0].reading;
  const prevReading = existing[0].previous_reading;
  const recordedAt = existing[0].recorded_at;
  const newKmSinceLast = prevReading !== null ? newReading - prevReading : null;

  await sql`UPDATE fleet_odometer_history
    SET reading = ${newReading}, km_since_last = ${newKmSinceLast}, source = 'admin_correction', updated_at = NOW()
    WHERE id = ${recordId}`;

  // Recalculate next record's km_since_last
  const nextRecord = await sql`
    SELECT id, reading FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId} AND recorded_at > ${recordedAt}
    ORDER BY recorded_at ASC LIMIT 1
  ` as Array<{ id: string; reading: number }>;

  if (nextRecord.length > 0) {
    await sql`UPDATE fleet_odometer_history
      SET previous_reading = ${newReading}, km_since_last = ${nextRecord[0].reading - newReading}
      WHERE id = ${nextRecord[0].id}`;
  }

  log.info('Admin corrected odometer reading', { vehicleId, recordId, oldReading, newReading });
  return apiResponse.success(res, { id: recordId, oldReading, newReading, kmSinceLast: newKmSinceLast });
}

/**
 * Create an anomaly record for flagged odometer readings
 */
async function createAnomalyRecord(
  vehicleId: string,
  reading: OdometerHistory,
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
      ${reading.id},
      ${anomalyType},
      ${reading.reading},
      ${reading.previousReading},
      ${reading.kmSinceLast},
      ${severity},
      NOW()
    )
  `;
}

export default withAuth(handler);
