/**
 * Pipeline Service Authorities API
 * GET /api/pipeline/authorities - List authorities with filters
 * POST /api/pipeline/authorities - Create new authority
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db/pool';
import { withAuth } from '@/lib/auth';
import type {
  ServiceAuthorityFilters,
  CreateServiceAuthorityInput,
  ServiceAuthorityWithType,
} from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

/**
 * GET /api/pipeline/authorities
 * Query params:
 * - search: string - Full-text search
 * - approval_type_id: string - Filter by approval type
 * - province: string - Filter by province
 * - municipality: string - Filter by municipality
 * - is_active: boolean - Filter by active status
 * - page: number - Page number (default 1)
 * - limit: number - Items per page (default 20)
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
  const {
    search,
    approval_type_id,
    province,
    municipality,
    is_active,
    page = '1',
    limit = '20',
  } = req.query;

  // Build query
  const conditions: string[] = [];
  const params: (string | boolean | number)[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', $${paramIndex})`);
    params.push(String(search));
    paramIndex++;
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

  if (is_active !== undefined) {
    conditions.push(`sa.is_active = $${paramIndex}`);
    params.push(is_active === 'true');
    paramIndex++;
  } else {
    // Default to active only
    conditions.push('sa.is_active = true');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  // Count total
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM pipeline_service_authorities sa
     ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  // Get authorities with type info
  const result = await query<ServiceAuthorityWithType>(
    `SELECT
       sa.*,
       pat.name as approval_type_name,
       pat.code as approval_type_code,
       pat.category as approval_type_category
     FROM pipeline_service_authorities sa
     LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
     ${whereClause}
     ORDER BY sa.authority_name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limitNum, offset]
  );

  return apiResponse.success(res, {
    authorities: result.rows,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
  } catch (err) {
    console.error('[authorities/index] handleGet error:', err);
    throw err;
  }
}

/**
 * POST /api/pipeline/authorities
 * Create a new service authority
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const input = req.body as CreateServiceAuthorityInput;

  // Validate required fields
  if (!input.authority_name?.trim()) {
    return apiResponse.badRequest(res, 'Authority name is required');
  }

  if (!input.approval_type_id) {
    return apiResponse.badRequest(res, 'Approval type is required');
  }

  const result = await query<ServiceAuthorityWithType>(
    `INSERT INTO pipeline_service_authorities (
       approval_type_id,
       province,
       municipality,
       region,
       authority_name,
       department,
       contact_name,
       contact_title,
       contact_email,
       contact_phone,
       contact_mobile,
       physical_address,
       postal_address,
       office_hours,
       website,
       typical_turnaround_days,
       application_fee,
       notes,
       created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      input.approval_type_id,
      input.province || null,
      input.municipality || null,
      input.region || null,
      input.authority_name.trim(),
      input.department || null,
      input.contact_name || null,
      input.contact_title || null,
      input.contact_email || null,
      input.contact_phone || null,
      input.contact_mobile || null,
      input.physical_address || null,
      input.postal_address || null,
      input.office_hours || null,
      input.website || null,
      input.typical_turnaround_days || null,
      input.application_fee || null,
      input.notes || null,
      input.created_by || null,
    ]
  );

  return apiResponse.created(res, result.rows[0]);
}

export default withAuth(withErrorHandler(handler));
