/**
 * Fleet GPS Investigation Trips API
 * Get trips for a specific investigation job
 *
 * GET /api/fleet/investigation/[jobId]/trips - Get all trips for a job
 * Query params:
 *   - classification: 'AUTHORIZED' | 'UNAUTHORIZED' - Filter by classification
 *   - dayType: 'WEEKDAY' | 'WEEKEND' - Filter by day type
 *   - timeCategory: 'WORK_HOURS' | 'AFTER_HOURS' | 'NIGHT_TRAVEL' - Filter by time
 *   - page: number - Page number (default: 1)
 *   - limit: number - Items per page (default: 50, max: 100)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse } from '@/lib/apiResponse';

const getSqlInstance = () => getSql();

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = getSqlInstance();
  const { jobId, classification, dayType, timeCategory, page = '1', limit = '50' } = req.query;

  if (!jobId || typeof jobId !== 'string') {
    return apiResponse.validationError(res, { jobId: 'Job ID is required' });
  }

  // Verify job exists
  const jobs = await sql`SELECT id FROM fleet_gps_jobs WHERE id = ${jobId}` as Record<string, unknown>[];
  if (jobs.length === 0) {
    return apiResponse.notFound(res, 'Investigation Job', jobId);
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offset = (pageNum - 1) * limitNum;

  // Build query with filters
  let trips;
  let countResult;

  if (classification && dayType && timeCategory) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId}
        AND t.classification = ${classification}
        AND t.day_type = ${dayType}
        AND t.time_category = ${timeCategory}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId}
        AND classification = ${classification}
        AND day_type = ${dayType}
        AND time_category = ${timeCategory}
    `;
  } else if (classification && dayType) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId}
        AND t.classification = ${classification}
        AND t.day_type = ${dayType}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId}
        AND classification = ${classification}
        AND day_type = ${dayType}
    `;
  } else if (classification && timeCategory) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId}
        AND t.classification = ${classification}
        AND t.time_category = ${timeCategory}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId}
        AND classification = ${classification}
        AND time_category = ${timeCategory}
    `;
  } else if (classification) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId} AND t.classification = ${classification}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId} AND classification = ${classification}
    `;
  } else if (dayType) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId} AND t.day_type = ${dayType}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId} AND day_type = ${dayType}
    `;
  } else if (timeCategory) {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId} AND t.time_category = ${timeCategory}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips
      WHERE job_id = ${jobId} AND time_category = ${timeCategory}
    `;
  } else {
    trips = await sql`
      SELECT
        t.id,
        t.trip_number as "tripNumber",
        t.start_time as "startTime",
        t.end_time as "endTime",
        t.start_lat as "startLat",
        t.start_lon as "startLon",
        t.end_lat as "endLat",
        t.end_lon as "endLon",
        t.start_location as "startLocation",
        t.end_location as "endLocation",
        t.distance_km as "distanceKm",
        t.classification,
        t.time_category as "timeCategory",
        t.day_type as "dayType",
        t.is_work_hours_violation as "isWorkHoursViolation",
        t.nearest_auth_location as "nearestAuthLocation",
        t.distance_from_auth_km as "distanceFromAuthKm",
        t.created_at as "createdAt"
      FROM fleet_gps_trips t
      WHERE t.job_id = ${jobId}
      ORDER BY t.start_time ASC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_trips WHERE job_id = ${jobId}
    ` as Record<string, unknown>[];
  }

  const countArr = countResult as Record<string, unknown>[];
  const total = parseInt((countArr[0]?.total as string) || '0', 10);

  return apiResponse.paginated(res, trips as Record<string, unknown>[], {
    page: pageNum,
    pageSize: limitNum,
    total,
  });
});
