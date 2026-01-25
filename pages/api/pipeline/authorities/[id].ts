/**
 * Pipeline Service Authority API
 * GET /api/pipeline/authorities/[id] - Get authority by ID
 * PUT /api/pipeline/authorities/[id] - Update authority
 * DELETE /api/pipeline/authorities/[id] - Delete authority (soft)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
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
  const result = (await sql`
    SELECT
      sa.*,
      pat.name as approval_type_name,
      pat.code as approval_type_code,
      pat.category as approval_type_category
    FROM pipeline_service_authorities sa
    LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
    WHERE sa.id = ${id}
  `) as ServiceAuthorityWithType[];

  if (result.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  return apiResponse.success(res, result[0]);
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

  // First check if the authority exists
  const existing = (await sql`
    SELECT id FROM pipeline_service_authorities WHERE id = ${id}
  `) as { id: string }[];

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  // Update with all provided fields
  const result = (await sql`
    UPDATE pipeline_service_authorities SET
      approval_type_id = COALESCE(${input.approval_type_id ?? null}, approval_type_id),
      province = CASE WHEN ${input.province !== undefined} THEN ${input.province ?? null} ELSE province END,
      municipality = CASE WHEN ${input.municipality !== undefined} THEN ${input.municipality ?? null} ELSE municipality END,
      region = CASE WHEN ${input.region !== undefined} THEN ${input.region ?? null} ELSE region END,
      authority_name = COALESCE(${input.authority_name ?? null}, authority_name),
      department = CASE WHEN ${input.department !== undefined} THEN ${input.department ?? null} ELSE department END,
      contact_name = CASE WHEN ${input.contact_name !== undefined} THEN ${input.contact_name ?? null} ELSE contact_name END,
      contact_title = CASE WHEN ${input.contact_title !== undefined} THEN ${input.contact_title ?? null} ELSE contact_title END,
      contact_email = CASE WHEN ${input.contact_email !== undefined} THEN ${input.contact_email ?? null} ELSE contact_email END,
      contact_phone = CASE WHEN ${input.contact_phone !== undefined} THEN ${input.contact_phone ?? null} ELSE contact_phone END,
      contact_mobile = CASE WHEN ${input.contact_mobile !== undefined} THEN ${input.contact_mobile ?? null} ELSE contact_mobile END,
      physical_address = CASE WHEN ${input.physical_address !== undefined} THEN ${input.physical_address ?? null} ELSE physical_address END,
      postal_address = CASE WHEN ${input.postal_address !== undefined} THEN ${input.postal_address ?? null} ELSE postal_address END,
      office_hours = CASE WHEN ${input.office_hours !== undefined} THEN ${input.office_hours ?? null} ELSE office_hours END,
      website = CASE WHEN ${input.website !== undefined} THEN ${input.website ?? null} ELSE website END,
      typical_turnaround_days = CASE WHEN ${input.typical_turnaround_days !== undefined} THEN ${input.typical_turnaround_days ?? null} ELSE typical_turnaround_days END,
      application_fee = CASE WHEN ${input.application_fee !== undefined} THEN ${input.application_fee ?? null} ELSE application_fee END,
      notes = CASE WHEN ${input.notes !== undefined} THEN ${input.notes ?? null} ELSE notes END,
      is_active = COALESCE(${input.is_active ?? null}, is_active),
      updated_at = NOW(),
      updated_by = COALESCE(${input.updated_by ?? null}, updated_by)
    WHERE id = ${id}
    RETURNING *
  `) as ServiceAuthorityWithType[];

  return apiResponse.success(res, result[0]);
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
  const result = (await sql`
    UPDATE pipeline_service_authorities
    SET is_active = false, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id
  `) as { id: string }[];

  if (result.length === 0) {
    return apiResponse.notFound(res, 'Authority', id);
  }

  return apiResponse.success(res, { message: 'Authority deactivated' });
}

export default withAuth(withErrorHandler(handler));
