/**
 * Fleet GPS Investigation Jobs List API
 * List all investigation jobs
 *
 * GET /api/fleet/investigation - List all jobs
 * Query params:
 *   - vehicleId: Filter by vehicle
 *   - status: 'pending' | 'processing' | 'completed' | 'failed'
 *   - page: number (default: 1)
 *   - limit: number (default: 20, max: 50)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const getSqlInstance = () => getSql();

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = getSqlInstance();
  const { vehicleId, status, page = '1', limit = '20' } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = Math.min(parseInt(limit as string, 10), 50);
  const offset = (pageNum - 1) * limitNum;

  let jobs;
  let countResult;

  if (vehicleId && status) {
    jobs = await sql`
      SELECT
        j.id,
        j.vehicle_id as "vehicleId",
        j.file_name as "fileName",
        j.file_size as "fileSize",
        j.status,
        j.progress,
        j.error_message as "errorMessage",
        j.period_start as "periodStart",
        j.period_end as "periodEnd",
        j.total_gps_points as "totalGpsPoints",
        j.report_url as "reportUrl",
        j.created_at as "createdAt",
        j.completed_at as "completedAt",
        fv.registration as "vehicleRegistration",
        fv.make as "vehicleMake",
        fv.model as "vehicleModel",
        s.total_trips as "totalTrips",
        s.unauthorized_trips as "unauthorizedTrips",
        s.unauthorized_cost as "unauthorizedCost"
      FROM fleet_gps_jobs j
      LEFT JOIN fleet_vehicles fv ON fv.id = j.vehicle_id
      LEFT JOIN fleet_investigation_summaries s ON s.job_id = j.id
      WHERE j.vehicle_id = ${vehicleId} AND j.status = ${status}
      ORDER BY j.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_jobs
      WHERE vehicle_id = ${vehicleId} AND status = ${status}
    `;
  } else if (vehicleId) {
    jobs = await sql`
      SELECT
        j.id,
        j.vehicle_id as "vehicleId",
        j.file_name as "fileName",
        j.file_size as "fileSize",
        j.status,
        j.progress,
        j.error_message as "errorMessage",
        j.period_start as "periodStart",
        j.period_end as "periodEnd",
        j.total_gps_points as "totalGpsPoints",
        j.report_url as "reportUrl",
        j.created_at as "createdAt",
        j.completed_at as "completedAt",
        fv.registration as "vehicleRegistration",
        fv.make as "vehicleMake",
        fv.model as "vehicleModel",
        s.total_trips as "totalTrips",
        s.unauthorized_trips as "unauthorizedTrips",
        s.unauthorized_cost as "unauthorizedCost"
      FROM fleet_gps_jobs j
      LEFT JOIN fleet_vehicles fv ON fv.id = j.vehicle_id
      LEFT JOIN fleet_investigation_summaries s ON s.job_id = j.id
      WHERE j.vehicle_id = ${vehicleId}
      ORDER BY j.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_jobs WHERE vehicle_id = ${vehicleId}
    `;
  } else if (status) {
    jobs = await sql`
      SELECT
        j.id,
        j.vehicle_id as "vehicleId",
        j.file_name as "fileName",
        j.file_size as "fileSize",
        j.status,
        j.progress,
        j.error_message as "errorMessage",
        j.period_start as "periodStart",
        j.period_end as "periodEnd",
        j.total_gps_points as "totalGpsPoints",
        j.report_url as "reportUrl",
        j.created_at as "createdAt",
        j.completed_at as "completedAt",
        fv.registration as "vehicleRegistration",
        fv.make as "vehicleMake",
        fv.model as "vehicleModel",
        s.total_trips as "totalTrips",
        s.unauthorized_trips as "unauthorizedTrips",
        s.unauthorized_cost as "unauthorizedCost"
      FROM fleet_gps_jobs j
      LEFT JOIN fleet_vehicles fv ON fv.id = j.vehicle_id
      LEFT JOIN fleet_investigation_summaries s ON s.job_id = j.id
      WHERE j.status = ${status}
      ORDER BY j.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_gps_jobs WHERE status = ${status}
    `;
  } else {
    jobs = await sql`
      SELECT
        j.id,
        j.vehicle_id as "vehicleId",
        j.file_name as "fileName",
        j.file_size as "fileSize",
        j.status,
        j.progress,
        j.error_message as "errorMessage",
        j.period_start as "periodStart",
        j.period_end as "periodEnd",
        j.total_gps_points as "totalGpsPoints",
        j.report_url as "reportUrl",
        j.created_at as "createdAt",
        j.completed_at as "completedAt",
        fv.registration as "vehicleRegistration",
        fv.make as "vehicleMake",
        fv.model as "vehicleModel",
        s.total_trips as "totalTrips",
        s.unauthorized_trips as "unauthorizedTrips",
        s.unauthorized_cost as "unauthorizedCost"
      FROM fleet_gps_jobs j
      LEFT JOIN fleet_vehicles fv ON fv.id = j.vehicle_id
      LEFT JOIN fleet_investigation_summaries s ON s.job_id = j.id
      ORDER BY j.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    countResult = await sql`SELECT COUNT(*) as total FROM fleet_gps_jobs` as Record<string, unknown>[];
  }

  const countArr = countResult as Record<string, unknown>[];
  const total = parseInt((countArr[0]?.total as string) || '0', 10);

  return apiResponse.paginated(res, jobs as Record<string, unknown>[], {
    page: pageNum,
    pageSize: limitNum,
    total,
  });
}));
