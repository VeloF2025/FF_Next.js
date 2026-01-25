/**
 * Pipeline Service Authorities Quick Search API
 * GET /api/pipeline/authorities/search - Search for authority picker
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth } from '@/lib/auth';
import type { ServiceAuthoritySearchResult } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { q, approval_type_id, province, municipality, limit = '10' } = req.query;

  // Require at least approval_type_id or search query
  if (!approval_type_id && !q) {
    return apiResponse.badRequest(
      res,
      'Either approval_type_id or search query (q) is required'
    );
  }

  const limitNum = Math.min(20, Math.max(1, parseInt(String(limit), 10) || 10));
  const searchPattern = q ? `%${String(q)}%` : null;

  const result = (await sql`
    SELECT
      sa.id,
      sa.authority_name,
      sa.department,
      sa.municipality,
      sa.province,
      sa.contact_name,
      sa.contact_email,
      sa.contact_phone,
      sa.typical_turnaround_days,
      sa.application_fee
    FROM pipeline_service_authorities sa
    WHERE sa.is_active = true
      ${approval_type_id ? sql`AND sa.approval_type_id = ${String(approval_type_id)}` : sql``}
      ${province ? sql`AND sa.province = ${String(province)}` : sql``}
      ${municipality ? sql`AND sa.municipality = ${String(municipality)}` : sql``}
      ${searchPattern ? sql`AND (
        sa.authority_name ILIKE ${searchPattern} OR
        sa.department ILIKE ${searchPattern} OR
        sa.municipality ILIKE ${searchPattern} OR
        sa.contact_name ILIKE ${searchPattern}
      )` : sql``}
    ORDER BY
      ${searchPattern
        ? sql`
          CASE
            WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
            WHEN sa.authority_name ILIKE ${String(q) + '%'} THEN 2
            ELSE 3
          END,
          sa.authority_name ASC
        `
        : sql`sa.authority_name ASC`}
    LIMIT ${limitNum}
  `) as ServiceAuthoritySearchResult[];

  return apiResponse.success(res, result);
}

export default withAuth(withErrorHandler(handler));
