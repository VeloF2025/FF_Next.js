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
              COALESCE(s.company_name, s.name, 'Unknown Contractor') as contractor_name,
              ca.reference_number,
              ca.status,
              ca.effective_date,
              ca.expiry_date,
              COALESCE(ca.total_value, 0)::numeric as total_value,
              ca.signed_date,
              ca.created_at
            FROM contractor_agreements ca
            LEFT JOIN suppliers s ON ca.contractor_id = s.id
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
          reference_number,
          effective_date,
          expiry_date,
          total_value,
          description,
        } = req.body;

        if (!agreement_type || !contractor_id || !reference_number) {
          return apiResponse.badRequest(res, 'Missing required fields: agreement_type, contractor_id, reference_number');
        }

        const result = await sql`
          INSERT INTO contractor_agreements (
            project_id,
            agreement_type,
            contractor_id,
            reference_number,
            status,
            effective_date,
            expiry_date,
            total_value,
            description,
            created_at,
            updated_at
          ) VALUES (
            ${projectId},
            ${agreement_type},
            ${contractor_id},
            ${reference_number},
            'draft',
            ${effective_date || null},
            ${expiry_date || null},
            ${total_value || 0},
            ${description || null},
            NOW(),
            NOW()
          )
          RETURNING *
        `;

        log.info('ProjectAgreements', { action: 'create', projectId, reference_number });

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
