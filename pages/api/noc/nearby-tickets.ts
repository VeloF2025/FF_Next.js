/**
 * Nearby Tickets API
 * GET /api/noc/nearby-tickets?lat=<lat>&lng=<lng>&radius=100&exclude=<ticketId>
 *
 * Returns tickets within a given radius (meters) of a GPS coordinate.
 * Uses Haversine formula in SQL for distance calculation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { lat, lng, radius, exclude } = req.query;

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);
  const radiusMeters = parseInt(radius as string, 10) || 100;
  const excludeId = typeof exclude === 'string' ? exclude : null;

  if (isNaN(latitude) || isNaN(longitude)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'lat and lng are required numeric parameters');
  }

  try {
    // Haversine formula in SQL — calculates distance in meters between two GPS points.
    // gps_coordinates is stored as text "lat,lng" so we split it.
    const rows = await sql`
      WITH parsed AS (
        SELECT
          t.id,
          t.ticket_uid,
          t.title,
          t.status,
          t.dr_number,
          t.created_at,
          t.gps_coordinates,
          CAST(SPLIT_PART(t.gps_coordinates, ',', 1) AS DOUBLE PRECISION) AS t_lat,
          CAST(SPLIT_PART(t.gps_coordinates, ',', 2) AS DOUBLE PRECISION) AS t_lng
        FROM maintenance_tickets t
        WHERE t.gps_coordinates IS NOT NULL
          AND t.gps_coordinates LIKE '%,%'
          AND t.status NOT IN ('closed', 'cancelled')
      )
      SELECT
        p.id,
        p.ticket_uid,
        p.title,
        p.status,
        p.dr_number,
        p.created_at,
        p.gps_coordinates,
        ROUND(CAST(
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(p.t_lat - ${latitude}) / 2), 2) +
            COS(RADIANS(${latitude})) * COS(RADIANS(p.t_lat)) *
            POWER(SIN(RADIANS(p.t_lng - ${longitude}) / 2), 2)
          ))
        AS NUMERIC), 0) AS distance_meters
      FROM parsed p
      WHERE (${excludeId}::text IS NULL OR p.id::text != ${excludeId})
        AND 6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(p.t_lat - ${latitude}) / 2), 2) +
          COS(RADIANS(${latitude})) * COS(RADIANS(p.t_lat)) *
          POWER(SIN(RADIANS(p.t_lng - ${longitude}) / 2), 2)
        )) <= ${radiusMeters}
      ORDER BY distance_meters ASC
      LIMIT 20
    `;

    return apiResponse.success(res, rows);
  } catch (error) {
    log.error('Nearby tickets API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
