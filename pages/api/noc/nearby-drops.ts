/**
 * Nearby Drops API
 * GET /api/noc/nearby-drops?lat=<lat>&lng=<lng>&radius=100
 *
 * Returns drops (and optionally poles) within a given radius (meters) of a GPS
 * coordinate.  The drops query is tried first; if it returns no results the
 * poles table is queried as a fallback so that the caller always gets the best
 * available spatial context.
 *
 * Uses the Haversine formula in SQL for distance calculation — same approach as
 * nearby-tickets.ts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

/** Shape returned for a nearby drop record. */
interface NearbyDrop {
  drop_number: string;
  latitude: number | null;
  longitude: number | null;
  project_id: string | null;
  project_name: string | null;
  zone_id: number | null;
  pole_uuid: string | null;
  pon: number | null;
  distance_meters: number;
  source: 'drop';
}

/** Shape returned for a nearby pole record (fallback). */
interface NearbyPole {
  pole_uuid: string;
  latitude: number | null;
  longitude: number | null;
  project_id: string | null;
  project_name: string | null;
  distance_meters: number;
  source: 'pole';
}

type NearbyResult = NearbyDrop | NearbyPole;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { lat, lng, radius } = req.query;

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);
  const radiusMeters = parseInt(radius as string, 10) || 100;

  if (isNaN(latitude) || isNaN(longitude)) {
    return apiResponse.error(
      res,
      ErrorCode.BAD_REQUEST,
      'lat and lng are required numeric parameters'
    );
  }

  try {
    // -------------------------------------------------------------------------
    // Primary query: drops within radius
    // Joins projects to get project_name.  zone_id maps to drops.zone_no,
    // pole_uuid maps to drops.pole_number (the textual pole reference stored
    // on the drop row), pon maps to drops.pon_no.
    // -------------------------------------------------------------------------
    const dropRows = await sql`
      SELECT
        d.drop_number,
        d.latitude,
        d.longitude,
        d.project_id,
        p.project_name,
        d.zone_no                                     AS zone_id,
        d.pole_number                                 AS pole_uuid,
        d.pon_no                                      AS pon,
        ROUND(CAST(
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(d.latitude - ${latitude}) / 2), 2) +
            COS(RADIANS(${latitude})) * COS(RADIANS(d.latitude)) *
            POWER(SIN(RADIANS(d.longitude - ${longitude}) / 2), 2)
          ))
        AS NUMERIC), 0)                               AS distance_meters
      FROM drops d
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.latitude IS NOT NULL
        AND d.longitude IS NOT NULL
        AND 6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(d.latitude - ${latitude}) / 2), 2) +
          COS(RADIANS(${latitude})) * COS(RADIANS(d.latitude)) *
          POWER(SIN(RADIANS(d.longitude - ${longitude}) / 2), 2)
        )) <= ${radiusMeters}
      ORDER BY distance_meters ASC
      LIMIT 5
    `;

    if (dropRows.length > 0) {
      const results: NearbyDrop[] = dropRows.map((r) => ({
        drop_number:    r.drop_number as string,
        latitude:       r.latitude != null ? Number(r.latitude) : null,
        longitude:      r.longitude != null ? Number(r.longitude) : null,
        project_id:     (r.project_id as string | null) ?? null,
        project_name:   (r.project_name as string | null) ?? null,
        zone_id:        r.zone_id != null ? Number(r.zone_id) : null,
        pole_uuid:      (r.pole_uuid as string | null) ?? null,
        pon:            r.pon != null ? Number(r.pon) : null,
        distance_meters: Number(r.distance_meters),
        source:         'drop',
      }));
      return apiResponse.success(res, results);
    }

    // -------------------------------------------------------------------------
    // Fallback query: poles within radius (when no drops found)
    // Returns pole id (UUID), coordinates, project details, and distance.
    // -------------------------------------------------------------------------
    log.info('nearby-drops: no drops found within radius, trying poles fallback', {
      latitude,
      longitude,
      radiusMeters,
    });

    const poleRows = await sql`
      SELECT
        po.id                                         AS pole_uuid,
        po.latitude,
        po.longitude,
        po.project_id,
        p.project_name,
        ROUND(CAST(
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(po.latitude - ${latitude}) / 2), 2) +
            COS(RADIANS(${latitude})) * COS(RADIANS(po.latitude)) *
            POWER(SIN(RADIANS(po.longitude - ${longitude}) / 2), 2)
          ))
        AS NUMERIC), 0)                               AS distance_meters
      FROM poles po
      LEFT JOIN projects p ON p.id = po.project_id
      WHERE po.latitude IS NOT NULL
        AND po.longitude IS NOT NULL
        AND 6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(po.latitude - ${latitude}) / 2), 2) +
          COS(RADIANS(${latitude})) * COS(RADIANS(po.latitude)) *
          POWER(SIN(RADIANS(po.longitude - ${longitude}) / 2), 2)
        )) <= ${radiusMeters}
      ORDER BY distance_meters ASC
      LIMIT 5
    `;

    const poleResults: NearbyPole[] = poleRows.map((r) => ({
      pole_uuid:      r.pole_uuid as string,
      latitude:       r.latitude != null ? Number(r.latitude) : null,
      longitude:      r.longitude != null ? Number(r.longitude) : null,
      project_id:     (r.project_id as string | null) ?? null,
      project_name:   (r.project_name as string | null) ?? null,
      distance_meters: Number(r.distance_meters),
      source:         'pole',
    }));

    const results: NearbyResult[] = poleResults;
    return apiResponse.success(res, results);
  } catch (error) {
    log.error('Nearby drops API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
