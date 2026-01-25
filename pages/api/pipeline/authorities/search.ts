/**
 * Pipeline Service Authorities Quick Search API
 * GET /api/pipeline/authorities/search - Search for authority picker
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db/pool';
import { withAuth } from '@/lib/auth';
import type { ServiceAuthoritySearchResult } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { q, approval_type_id, province, municipality, limit = '10' } = req.query;

  // Build query conditions
  const conditions: string[] = ['sa.is_active = true'];
  const params: string[] = [];
  let paramIndex = 1;

  // Require at least approval_type_id or search query
  if (!approval_type_id && !q) {
    return apiResponse.badRequest(
      res,
      'Either approval_type_id or search query (q) is required'
    );
  }

  if (approval_type_id) {
    conditions.push(`sa.approval_type_id = $${paramIndex}`);
    params.push(String(approval_type_id));
    paramIndex++;
  }

  if (province) {
    conditions.push(`sa.province = $${paramIndex}`);
    params.push(String(province));
    paramIndex++;
  }

  if (municipality) {
    conditions.push(`sa.municipality = $${paramIndex}`);
    params.push(String(municipality));
    paramIndex++;
  }

  // Build search clause
  let orderClause = 'sa.authority_name ASC';
  if (q) {
    // Use similarity matching for better results
    conditions.push(
      `(
        sa.authority_name ILIKE $${paramIndex} OR
        sa.department ILIKE $${paramIndex} OR
        sa.municipality ILIKE $${paramIndex} OR
        sa.contact_name ILIKE $${paramIndex}
      )`
    );
    params.push(`%${String(q)}%`);
    paramIndex++;

    // Order by relevance (exact match first, then prefix, then contains)
    orderClause = `
      CASE
        WHEN sa.authority_name ILIKE $${paramIndex - 1} THEN 1
        WHEN sa.authority_name ILIKE $${paramIndex}||'%' THEN 2
        ELSE 3
      END,
      sa.authority_name ASC
    `;
    params.push(String(q));
    paramIndex++;
  }

  const limitNum = Math.min(20, Math.max(1, parseInt(String(limit), 10) || 10));

  const result = await query<ServiceAuthoritySearchResult>(
    `SELECT
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
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderClause}
     LIMIT $${paramIndex}`,
    [...params, limitNum]
  );

  return apiResponse.success(res, result.rows);
}

export default withAuth(withErrorHandler(handler));
