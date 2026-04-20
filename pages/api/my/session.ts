/**
 * GET /api/my/session — return the current /my portal session + staff profile.
 *
 * Returns 200 with `{ session: null }` when there's no valid cookie — callers
 * use this to render the login screen. Only returns 4xx on malformed requests.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { verifySession } from '@/modules/attendance/portal/sessionUtils';
import type { AttendanceSessionProfile } from '@/modules/attendance/portal/types';

export const config = {
  api: {
    bodyParser: { sizeLimit: '4kb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { valid, session, reason } = await verifySession(req);
    if (!valid || !session) {
      return apiResponse.success(res, { session: null, profile: null, reason: reason ?? 'no_session' });
    }

    const rows = await sql<{
      id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      home_site_id: string | null;
      has_vehicle: boolean;
    }>`
      SELECT
        s.id,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
        s.phone,
        s.email,
        s.home_site_id,
        EXISTS (
          SELECT 1 FROM vehicle_assignments va
          WHERE va.staff_id = s.id AND va.is_active = true
        ) AS has_vehicle
      FROM staff s
      WHERE s.id = ${session.staffId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return apiResponse.success(res, { session: null, profile: null, reason: 'staff_not_found' });
    }

    const profile: AttendanceSessionProfile = {
      staffId: row.id,
      name: row.full_name,
      phone: row.phone,
      email: row.email,
      homeSiteId: row.home_site_id,
      hasAssignedVehicle: row.has_vehicle,
    };

    return apiResponse.success(res, {
      session: {
        sessionId: session.sessionId,
        staffId: session.staffId,
        method: session.method,
        expiresAt: session.expiresAt,
      },
      profile,
    });
  } catch (err) {
    log.error('[my-session] unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
