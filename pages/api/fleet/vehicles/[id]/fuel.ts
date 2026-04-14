/**
 * Fleet Vehicle Fuel History API
 * GET: List fuel level history for a vehicle
 * POST: Add a manual fuel level reading
 * PATCH: Admin correction of an existing fuel level reading
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  FuelHistory,
  FleetFuelHistoryRow,
} from '@/modules/fleet/types/check-in.types';
import { rowToFuelHistory } from '@/modules/fleet/types/check-in.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface CreateFuelReadingRequest {
  fuelLevel: number;
  source?: 'manual' | 'vlm';
  vlmConfidence?: number;
  notes?: string;
}

interface PatchFuelReadingRequest {
  fuelLevel: number;
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
    log.error('Fleet fuel API error', { error, vehicleId });
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
      SELECT id, vehicle_id, check_record_id, fuel_level, source, vlm_confidence,
             previous_level, level_change, recorded_at, created_at
      FROM fleet_fuel_history
      WHERE vehicle_id = ${vehicleId}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as FleetFuelHistoryRow[];

    if (rows.length === 0) {
      return apiResponse.success(res, null);
    }

    return apiResponse.success(res, rowToFuelHistory(rows[0]!));
  }

  // Get paginated history
  const rows = await sql`
    SELECT * FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT ${limitNum} OFFSET ${offsetNum}
  ` as FleetFuelHistoryRow[];

  // Get total count
  const countResult = await sql`
    SELECT COUNT(*) as total FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId}
  ` as Array<{ total: string }>;

  const total = parseInt(countResult[0]?.total || '0', 10);
  const history: FuelHistory[] = rows.map(rowToFuelHistory);

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
  const body = req.body as CreateFuelReadingRequest;

  // Validate required fields
  if (body.fuelLevel === undefined || body.fuelLevel === null) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Fuel level is required');
  }

  if (body.fuelLevel < 0 || body.fuelLevel > 100) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Fuel level must be between 0 and 100');
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
    SELECT fuel_level FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as Array<{ fuel_level: number }>;

  const previousLevel = previousRows[0]?.fuel_level ?? null;

  // Calculate level change
  const levelChange = previousLevel !== null ? body.fuelLevel - previousLevel : null;

  const source = body.source || 'manual';

  // Insert new reading
  const rows = await sql`
    INSERT INTO fleet_fuel_history (
      vehicle_id,
      fuel_level,
      source,
      vlm_confidence,
      previous_level,
      level_change,
      recorded_at
    ) VALUES (
      ${vehicleId},
      ${body.fuelLevel},
      ${source},
      ${body.vlmConfidence || null},
      ${previousLevel},
      ${levelChange},
      NOW()
    )
    RETURNING id, vehicle_id, check_record_id, fuel_level, source, vlm_confidence,
             previous_level, level_change, recorded_at, created_at
  ` as FleetFuelHistoryRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create fuel reading');
  }

  const reading = rowToFuelHistory(rows[0]);

  log.info('Created fuel level reading', {
    vehicleId,
    fuelLevel: body.fuelLevel,
    source,
    levelChange,
  });

  return apiResponse.created(res, {
    ...reading,
    comparison: {
      previousLevel,
      levelChange,
    },
  });
}

/**
 * PATCH: Admin correction of an existing fuel level reading
 */
async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { recordId } = req.query;
  const body = req.body as PatchFuelReadingRequest;

  if (!recordId || typeof recordId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'recordId query parameter is required');
  }

  if (body.fuelLevel === undefined || body.fuelLevel === null) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'fuelLevel is required');
  }

  if (body.fuelLevel < 0 || body.fuelLevel > 100) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Fuel level must be between 0 and 100');
  }

  // Fetch the existing record
  const existing = await sql`
    SELECT id, fuel_level, previous_level, recorded_at
    FROM fleet_fuel_history
    WHERE id = ${recordId} AND vehicle_id = ${vehicleId}
  ` as Array<{ id: string; fuel_level: number; previous_level: number | null; recorded_at: string }>;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Fuel reading', recordId);
  }

  const oldLevel = existing[0]!.fuel_level;
  const prevLevel = existing[0]!.previous_level;
  const recordedAt = existing[0]!.recorded_at;

  // Recalculate level_change for this record based on its previous_level
  const newLevelChange = prevLevel !== null ? body.fuelLevel - prevLevel : null;

  await sql`
    UPDATE fleet_fuel_history
    SET fuel_level = ${body.fuelLevel},
        level_change = ${newLevelChange},
        source = 'admin_correction',
        updated_at = NOW()
    WHERE id = ${recordId}
  `;

  // Recalculate the next record's previous_level and level_change
  const nextRecord = await sql`
    SELECT id, fuel_level FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId} AND recorded_at > ${recordedAt}
    ORDER BY recorded_at ASC
    LIMIT 1
  ` as Array<{ id: string; fuel_level: number }>;

  if (nextRecord.length > 0) {
    const nextLevelChange = nextRecord[0]!.fuel_level - body.fuelLevel;
    await sql`
      UPDATE fleet_fuel_history
      SET previous_level = ${body.fuelLevel},
          level_change = ${nextLevelChange}
      WHERE id = ${nextRecord[0]!.id}
    `;
  }

  log.info('Admin corrected fuel level reading', { vehicleId, recordId, oldLevel, newLevel: body.fuelLevel });
  return apiResponse.success(res, { id: recordId, oldLevel, newLevel: body.fuelLevel, levelChange: newLevelChange });
}

export default withAuth(handler);
