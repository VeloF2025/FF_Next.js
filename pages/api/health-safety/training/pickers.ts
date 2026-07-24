/**
 * H&S Training form pickers
 *
 * GET /api/health-safety/training/pickers
 *
 * The small reference lists the "record training" form needs in one round-trip:
 * contractors, internal staff, and contractor team members. Kept feature-local
 * so the form does not depend on the shape of unrelated list endpoints.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const [contractors, staff, teamMembers] = await Promise.all([
      sql`SELECT id, company_name FROM contractors WHERE status IN ('approved', 'pending') ORDER BY company_name`,
      sql`SELECT id, (first_name || ' ' || last_name) AS name FROM staff WHERE status = 'active' ORDER BY first_name, last_name`,
      sql`SELECT id, (first_name || ' ' || last_name) AS name, contractor_id FROM team_members WHERE is_active = true ORDER BY first_name, last_name`,
    ]);

    return apiResponse.success(res, { contractors, staff, team_members: teamMembers });
  } catch (error) {
    log.error('[H&S Training Pickers API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
