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

  // Build the base select — explicit branches to avoid conditional SQL fragments (Neon rule).
  // We branch on searchPattern presence for the ORDER BY, and on individual filters.
  // Rather than 16 branches, we use the searchPattern as the primary branch axis since
  // it affects both WHERE and ORDER BY, then handle approval_type_id/province/municipality
  // as secondary axes (8 branches per search axis = 16 total would be unwieldy).
  // Instead: build two top-level branches (with search / without search) and within each,
  // branch on the combination of the three optional ID/location filters.

  let result: ServiceAuthoritySearchResult[];

  if (searchPattern) {
    const startPattern = `${String(q)}%`;
    if (approval_type_id && province && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.province = ${String(province)}
          AND sa.municipality = ${String(municipality)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id && province) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.province = ${String(province)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.municipality = ${String(municipality)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (province && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.province = ${String(province)}
          AND sa.municipality = ${String(municipality)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (province) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.province = ${String(province)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.municipality = ${String(municipality)}
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND (sa.authority_name ILIKE ${searchPattern} OR sa.department ILIKE ${searchPattern}
               OR sa.municipality ILIKE ${searchPattern} OR sa.contact_name ILIKE ${searchPattern})
        ORDER BY CASE WHEN sa.authority_name ILIKE ${searchPattern} THEN 1
                      WHEN sa.authority_name ILIKE ${startPattern} THEN 2 ELSE 3 END,
                 sa.authority_name ASC
        LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    }
  } else {
    // No search pattern — ORDER BY name only
    if (approval_type_id && province && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.province = ${String(province)}
          AND sa.municipality = ${String(municipality)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id && province) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.province = ${String(province)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
          AND sa.municipality = ${String(municipality)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (approval_type_id) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.approval_type_id = ${String(approval_type_id)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (province && municipality) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
          AND sa.province = ${String(province)}
          AND sa.municipality = ${String(municipality)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else if (province) {
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true AND sa.province = ${String(province)}
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    } else {
      // approval_type_id is guaranteed by validation above (at least approval_type_id or q)
      result = (await sql`
        SELECT sa.id, sa.authority_name, sa.department, sa.municipality, sa.province,
               sa.contact_name, sa.contact_email, sa.contact_phone,
               sa.typical_turnaround_days, sa.application_fee
        FROM pipeline_service_authorities sa
        WHERE sa.is_active = true
        ORDER BY sa.authority_name ASC LIMIT ${limitNum}
      `) as ServiceAuthoritySearchResult[];
    }
  }

  return apiResponse.success(res, result);
}

export default withAuth(withErrorHandler(handler));
