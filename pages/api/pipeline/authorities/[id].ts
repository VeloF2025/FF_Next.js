/**
 * Pipeline Service Authority API
 * GET /api/pipeline/authorities/[id] - Get authority by ID
 * PUT /api/pipeline/authorities/[id] - Update authority
 * DELETE /api/pipeline/authorities/[id] - Delete authority (soft)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db/pool';
import { withAuth } from '@/lib/auth';
import type {
  UpdateServiceAuthorityInput,
  ServiceAuthorityWithType,
} from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Authority ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id);
    case 'PUT':
      return handlePut(req, res, id);
    case 'DELETE':
      return handleDelete(req, res, id);
    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

/**
 * GET /api/pipeline/authorities/[id]
 * Get authority by ID
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const result = await query<ServiceAuthorityWithType>(
    `SELECT
       sa.*,
       pat.name as approval_type_name,
       pat.code as approval_type_code,
       pat.category as approval_type_category
     FROM pipeline_service_authorities sa
     LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
     WHERE sa.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  return apiResponse.success(res, result.rows[0]);
}

/**
 * PUT /api/pipeline/authorities/[id]
 * Update authority
 */
async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const input = req.body as UpdateServiceAuthorityInput;

  // Build dynamic update query
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let paramIndex = 1;

  const fields: Array<keyof UpdateServiceAuthorityInput> = [
    'approval_type_id',
    'province',
    'municipality',
    'region',
    'authority_name',
    'department',
    'contact_name',
    'contact_title',
    'contact_email',
    'contact_phone',
    'contact_mobile',
    'physical_address',
    'postal_address',
    'office_hours',
    'website',
    'typical_turnaround_days',
    'application_fee',
    'notes',
    'is_active',
  ];

  for (const field of fields) {
    if (input[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(input[field] as string | number | boolean | null);
      paramIndex++;
    }
  }

  if (updates.length === 0) {
    return apiResponse.badRequest(res, 'No fields to update');
  }

  // Always update updated_at
  updates.push(`updated_at = NOW()`);

  if (input.updated_by) {
    updates.push(`updated_by = $${paramIndex}`);
    values.push(input.updated_by);
    paramIndex++;
  }

  values.push(id);

  const result = await query<ServiceAuthorityWithType>(
    `UPDATE pipeline_service_authorities
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  return apiResponse.success(res, result.rows[0]);
}

/**
 * DELETE /api/pipeline/authorities/[id]
 * Soft delete authority (set is_active = false)
 */
async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const result = await query(
    `UPDATE pipeline_service_authorities
     SET is_active = false, updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id]
  );

  if (result.rows.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  return apiResponse.success(res, { message: 'Authority deactivated' });
}

export default withAuth(withErrorHandler(handler));
