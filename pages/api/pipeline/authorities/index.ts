/**
 * Pipeline Service Authorities API
 * GET /api/pipeline/authorities - List authorities with filters
 * POST /api/pipeline/authorities - Create new authority
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth } from '@/lib/auth';
import type {
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
  const {
    search,
    approval_type_id,
    province,
    municipality,
    is_active,
    page = '1',
    limit = '20',
  } = req.query;

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
  const offset = (pageNum - 1) * limitNum;
  const isActiveFilter = is_active === undefined ? true : is_active === 'true';

  // Helper to build full-text search condition as a string for tsvector filter
  const searchStr = search ? String(search) : null;

  // Count total — explicit branches to avoid conditional SQL fragments (Neon rule)
  let countResult: { count: string }[];
  if (approval_type_id && province && municipality && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (approval_type_id && province && municipality) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
    `) as { count: string }[];
  } else if (approval_type_id && province && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.province = ${String(province)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (approval_type_id && province) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.province = ${String(province)}
    `) as { count: string }[];
  } else if (approval_type_id && municipality && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (approval_type_id && municipality) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.municipality = ${String(municipality)}
    `) as { count: string }[];
  } else if (approval_type_id && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (approval_type_id) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter} AND sa.approval_type_id = ${String(approval_type_id)}
    `) as { count: string }[];
  } else if (province && municipality && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (province && municipality) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
    `) as { count: string }[];
  } else if (province && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter} AND sa.province = ${String(province)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (province) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter} AND sa.province = ${String(province)}
    `) as { count: string }[];
  } else if (municipality && searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else if (municipality) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter} AND sa.municipality = ${String(municipality)}
    `) as { count: string }[];
  } else if (searchStr) {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
    `) as { count: string }[];
  } else {
    countResult = (await sql`
      SELECT COUNT(*) as count FROM pipeline_service_authorities sa
      WHERE sa.is_active = ${isActiveFilter}
    `) as { count: string }[];
  }

  const total = parseInt(countResult[0]?.count || '0', 10);

  // Get authorities with type info — same branch logic as count
  let authorities: ServiceAuthorityWithType[];
  if (approval_type_id && province && municipality && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && province && municipality) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && province && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.province = ${String(province)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && province) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.province = ${String(province)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && municipality && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && municipality) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)} AND sa.municipality = ${String(municipality)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.approval_type_id = ${String(approval_type_id)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (approval_type_id) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter} AND sa.approval_type_id = ${String(approval_type_id)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (province && municipality && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (province && municipality) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND sa.province = ${String(province)} AND sa.municipality = ${String(municipality)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (province && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter} AND sa.province = ${String(province)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (province) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter} AND sa.province = ${String(province)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (municipality && searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter} AND sa.municipality = ${String(municipality)}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (municipality) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter} AND sa.municipality = ${String(municipality)}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else if (searchStr) {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
        AND to_tsvector('english', sa.authority_name || ' ' || COALESCE(sa.department, '') || ' ' || COALESCE(sa.municipality, '')) @@ plainto_tsquery('english', ${searchStr})
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  } else {
    authorities = (await sql`
      SELECT sa.*, pat.name as approval_type_name, pat.code as approval_type_code,
             pat.category as approval_type_category
      FROM pipeline_service_authorities sa
      LEFT JOIN pipeline_approval_types pat ON pat.id = sa.approval_type_id
      WHERE sa.is_active = ${isActiveFilter}
      ORDER BY sa.authority_name ASC LIMIT ${limitNum} OFFSET ${offset}
    `) as ServiceAuthorityWithType[];
  }

  return apiResponse.success(res, {
    authorities,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
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

  const result = (await sql`
    INSERT INTO pipeline_service_authorities (
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
    ) VALUES (
      ${input.approval_type_id},
      ${input.province || null},
      ${input.municipality || null},
      ${input.region || null},
      ${input.authority_name.trim()},
      ${input.department || null},
      ${input.contact_name || null},
      ${input.contact_title || null},
      ${input.contact_email || null},
      ${input.contact_phone || null},
      ${input.contact_mobile || null},
      ${input.physical_address || null},
      ${input.postal_address || null},
      ${input.office_hours || null},
      ${input.website || null},
      ${input.typical_turnaround_days || null},
      ${input.application_fee || null},
      ${input.notes || null},
      ${input.created_by || null}
    )
    RETURNING *
  `) as ServiceAuthorityWithType[];

  return apiResponse.created(res, result[0]);
}

export default withAuth(withErrorHandler(handler));
