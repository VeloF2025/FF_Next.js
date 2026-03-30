/**
 * Contractors List API
 * GET /api/contractors-list - Returns active contractors for dropdowns
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = getSql();

  const rows = await sql`
    SELECT id, company_name, contact_person, status
    FROM contractors
    WHERE is_active = true
    ORDER BY company_name ASC
  `;

  return apiResponse.success(res, rows);
}

export default withAuth(handler);
