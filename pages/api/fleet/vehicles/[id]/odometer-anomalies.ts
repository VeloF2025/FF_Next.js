/**
 * Fleet Vehicle Odometer Anomalies API
 * GET: List anomalies for a vehicle
 * PATCH: Resolve an anomaly
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

// Anomaly types
type AnomalyType = 'rollback' | 'excessive' | 'under_reported' | 'static';
type AnomalySeverity = 'warning' | 'critical';

interface OdometerAnomaly {
  id: string;
  vehicleId: string;
  odometerHistoryId: string | null;
  anomalyType: AnomalyType;
  odometerReading: number;
  previousReading: number | null;
  odometerDiff: number | null;
  gpsDistanceKm: number | null;
  variancePercent: number | null;
  severity: AnomalySeverity;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  detectedAt: string;
  createdAt: string;
}

interface OdometerAnomalyRow {
  id: string;
  vehicle_id: string;
  odometer_history_id: string | null;
  anomaly_type: string;
  odometer_reading: number;
  previous_reading: number | null;
  odometer_diff: number | null;
  gps_distance_km: number | null;
  variance_percent: string | null;
  severity: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  detected_at: string;
  created_at: string;
}

function rowToAnomaly(row: OdometerAnomalyRow): OdometerAnomaly {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    odometerHistoryId: row.odometer_history_id,
    anomalyType: row.anomaly_type as AnomalyType,
    odometerReading: row.odometer_reading,
    previousReading: row.previous_reading,
    odometerDiff: row.odometer_diff,
    gpsDistanceKm: row.gps_distance_km,
    variancePercent: row.variance_percent ? parseFloat(row.variance_percent) : null,
    severity: row.severity as AnomalySeverity,
    resolved: row.resolved,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
    detectedAt: row.detected_at,
    createdAt: row.created_at,
  };
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
      case 'PATCH':
        return handlePatch(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'PATCH']);
    }
  } catch (error) {
    log.error('Fleet odometer anomalies API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { resolved, severity, limit = '50', offset = '0' } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offsetNum = parseInt(offset as string, 10);

  let rows: OdometerAnomalyRow[];
  let countResult: Array<{ total: string }>;

  // Build query based on filters
  if (resolved === 'true') {
    rows = await sql`
      SELECT id, vehicle_id, odometer_history_id, anomaly_type, odometer_reading,
             previous_reading, odometer_diff, gps_distance_km, variance_percent,
             severity, resolved, resolved_by, resolved_at, resolution_notes,
             detected_at, created_at
      FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId}
        AND resolved = true
      ORDER BY detected_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as OdometerAnomalyRow[];
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId} AND resolved = true
    ` as Array<{ total: string }>;
  } else if (resolved === 'false') {
    rows = await sql`
      SELECT id, vehicle_id, odometer_history_id, anomaly_type, odometer_reading,
             previous_reading, odometer_diff, gps_distance_km, variance_percent,
             severity, resolved, resolved_by, resolved_at, resolution_notes,
             detected_at, created_at
      FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId}
        AND resolved = false
      ORDER BY detected_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as OdometerAnomalyRow[];
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId} AND resolved = false
    ` as Array<{ total: string }>;
  } else if (severity && typeof severity === 'string') {
    rows = await sql`
      SELECT id, vehicle_id, odometer_history_id, anomaly_type, odometer_reading,
             previous_reading, odometer_diff, gps_distance_km, variance_percent,
             severity, resolved, resolved_by, resolved_at, resolution_notes,
             detected_at, created_at
      FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId}
        AND severity = ${severity}
      ORDER BY detected_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as OdometerAnomalyRow[];
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId} AND severity = ${severity}
    ` as Array<{ total: string }>;
  } else {
    rows = await sql`
      SELECT id, vehicle_id, odometer_history_id, anomaly_type, odometer_reading,
             previous_reading, odometer_diff, gps_distance_km, variance_percent,
             severity, resolved, resolved_by, resolved_at, resolution_notes,
             detected_at, created_at
      FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId}
      ORDER BY detected_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as OdometerAnomalyRow[];
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_odometer_anomalies
      WHERE vehicle_id = ${vehicleId}
    ` as Array<{ total: string }>;
  }

  const total = parseInt(countResult[0]?.total || '0', 10);
  const anomalies = rows.map(rowToAnomaly);

  // Also get summary counts
  const summaryRows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE resolved = false) as unresolved,
      COUNT(*) FILTER (WHERE resolved = false AND severity = 'critical') as critical_unresolved,
      COUNT(*) FILTER (WHERE resolved = false AND severity = 'warning') as warning_unresolved
    FROM fleet_odometer_anomalies
    WHERE vehicle_id = ${vehicleId}
  ` as Array<{ unresolved: string; critical_unresolved: string; warning_unresolved: string }>;

  return apiResponse.paginated(res, anomalies, {
    page: Math.floor(offsetNum / limitNum) + 1,
    pageSize: limitNum,
    total,
    meta: {
      summary: {
        unresolved: parseInt(summaryRows[0]?.unresolved || '0', 10),
        criticalUnresolved: parseInt(summaryRows[0]?.critical_unresolved || '0', 10),
        warningUnresolved: parseInt(summaryRows[0]?.warning_unresolved || '0', 10),
      },
    },
  });
}

async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { anomalyId, resolvedBy, resolutionNotes } = req.body as {
    anomalyId: string;
    resolvedBy: string;
    resolutionNotes?: string;
  };

  if (!anomalyId) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Anomaly ID is required');
  }

  if (!resolvedBy) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Resolver ID is required');
  }

  // Verify anomaly exists and belongs to vehicle
  const existing = await sql`
    SELECT id FROM fleet_odometer_anomalies
    WHERE id = ${anomalyId} AND vehicle_id = ${vehicleId}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Anomaly', anomalyId);
  }

  // Mark as resolved
  const rows = await sql`
    UPDATE fleet_odometer_anomalies
    SET
      resolved = true,
      resolved_by = ${resolvedBy},
      resolved_at = NOW(),
      resolution_notes = ${resolutionNotes || null}
    WHERE id = ${anomalyId}
    RETURNING id, vehicle_id, odometer_history_id, anomaly_type, odometer_reading,
              previous_reading, odometer_diff, gps_distance_km, variance_percent,
              severity, resolved, resolved_by, resolved_at, resolution_notes,
              detected_at, created_at
  ` as OdometerAnomalyRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to resolve anomaly');
  }

  log.info('Resolved odometer anomaly', {
    anomalyId,
    vehicleId,
    resolvedBy,
  });

  return apiResponse.success(res, rowToAnomaly(rows[0]));
}

export default withAuth(handler);
