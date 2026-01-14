/**
 * Fleet GPS Investigation Job API
 * Get job status and summary
 *
 * GET /api/fleet/investigation/[jobId] - Get job details with summary
 * DELETE /api/fleet/investigation/[jobId] - Delete job and all associated data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse } from '@/lib/apiResponse';

const getSqlInstance = () => getSql();

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const sql = getSqlInstance();
  const { jobId } = req.query;

  if (!jobId || typeof jobId !== 'string') {
    return apiResponse.validationError(res, { jobId: 'Job ID is required' });
  }

  switch (req.method) {
    case 'GET': {
      // Get job with summary and vehicle info
      const jobs = await sql`
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
          s.authorized_trips as "authorizedTrips",
          s.unauthorized_trips as "unauthorizedTrips",
          s.total_km as "totalKm",
          s.authorized_km as "authorizedKm",
          s.unauthorized_km as "unauthorizedKm",
          s.weekend_trips as "weekendTrips",
          s.after_hours_trips as "afterHoursTrips",
          s.work_hours_violations as "workHoursViolations",
          s.suspicious_poi_visits as "suspiciousPoiVisits",
          s.unauthorized_nights as "unauthorizedNights",
          s.total_cost as "totalCost",
          s.unauthorized_cost as "unauthorizedCost"
        FROM fleet_gps_jobs j
        LEFT JOIN fleet_vehicles fv ON fv.id = j.vehicle_id
        LEFT JOIN fleet_investigation_summaries s ON s.job_id = j.id
        WHERE j.id = ${jobId}
      ` as Record<string, unknown>[];

      if (jobs.length === 0) {
        return apiResponse.notFound(res, 'Investigation Job', jobId);
      }

      const job = jobs[0];

      // Get pattern counts
      const patternCounts = await sql`
        SELECT
          COUNT(*) FILTER (WHERE classification = 'UNAUTHORIZED' AND day_type = 'WEEKEND') as weekend,
          COUNT(*) FILTER (WHERE classification = 'UNAUTHORIZED' AND time_category = 'AFTER_HOURS') as after_hours,
          COUNT(*) FILTER (WHERE classification = 'UNAUTHORIZED' AND time_category = 'NIGHT_TRAVEL') as night_travel,
          COUNT(*) FILTER (WHERE is_work_hours_violation = true) as work_violations
        FROM fleet_gps_trips
        WHERE job_id = ${jobId}
      ` as Record<string, unknown>[];

      const counts = patternCounts[0] || {};
      return apiResponse.success(res, {
        ...job,
        patterns: {
          weekend: parseInt(counts.weekend as string) || 0,
          afterHours: parseInt(counts.after_hours as string) || 0,
          nightTravel: parseInt(counts.night_travel as string) || 0,
          workViolations: parseInt(counts.work_violations as string) || 0,
        },
      });
    }

    case 'DELETE': {
      // Delete job (cascade deletes trips, POIs, summary)
      const result = await sql`
        DELETE FROM fleet_gps_jobs
        WHERE id = ${jobId}
        RETURNING id
      ` as Record<string, unknown>[];

      if (result.length === 0) {
        return apiResponse.notFound(res, 'Investigation Job', jobId);
      }

      return apiResponse.success(res, { id: jobId }, 'Investigation deleted successfully');
    }

    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'DELETE']);
  }
});
