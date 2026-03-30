/**
 * Project Agreements API (PRD-058)
 * GET /api/projects/[projectId]/agreements - List agreements for a project
 * POST /api/projects/[projectId]/agreements - Create new agreement
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery } from '@/lib/safe-query';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

interface Agreement {
  id: string;
  agreement_type: string;
  contractor_id: string;
  contractor_name: string;
  reference_number: string;
  status: string;
  effective_date: string | null;
  expiry_date: string | null;
  total_value: number;
  signed_date: string | null;
  created_at: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  const sql = getSql();

  switch (req.method) {
    case 'GET': {
      try {
        // Try to fetch from contractor_agreements table
        const agreements = await safeArrayQuery(
          async () => sql`
            SELECT
              ca.id,
              ca.agreement_type,
              ca.contractor_id,
              COALESCE(c.company_name, 'Unknown Contractor') as contractor_name,
              ca.status,
              ca.effective_date,
              ca.expiry_date,
              ca.draft_document_url,
              ca.signed_document_url,
              ca.signed_at,
              ca.created_at
            FROM contractor_agreements ca
            LEFT JOIN contractors c ON ca.contractor_id = c.id
            WHERE ca.project_id = ${projectId}
            ORDER BY ca.created_at DESC
          `
        );

        log.info('ProjectAgreements', { projectId, count: agreements.length });

        return apiResponse.success(res, agreements);
      } catch (error) {
        // If contractor_agreements table doesn't exist, return empty array
        log.warn('ProjectAgreements', {
          projectId,
          error: error instanceof Error ? error.message : 'Unknown error',
          note: 'contractor_agreements table may not exist yet'
        });
        return apiResponse.success(res, []);
      }
    }

    case 'POST': {
      try {
        const {
          agreement_type,
          contractor_id,
          effective_date,
          expiry_date,
          created_by,
        } = req.body;

        if (!agreement_type || !contractor_id) {
          return apiResponse.badRequest(res, 'Missing required fields: agreement_type, contractor_id');
        }

        const result = await sql`
          INSERT INTO contractor_agreements (
            project_id,
            agreement_type,
            contractor_id,
            status,
            effective_date,
            expiry_date,
            created_by,
            created_at,
            updated_at
          ) VALUES (
            ${projectId},
            ${agreement_type},
            ${contractor_id},
            'draft',
            ${effective_date || null},
            ${expiry_date || null},
            ${created_by || 'system'},
            NOW(),
            NOW()
          )
          RETURNING *
        `;

        log.info('ProjectAgreements', { action: 'create', projectId, agreement_type });

        return apiResponse.created(res, result[0]);
      } catch (error) {
        log.error('ProjectAgreements', {
          action: 'create',
          projectId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return apiResponse.internalError(res, error as Error);
      }
    }

    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

export default withAuth(handler);
