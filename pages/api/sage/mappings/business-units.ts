/**
 * Sage Business Unit Listing API
 *
 * GET - List all business unit categories from Sage
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:mappings:business-units');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const businessUnits = await sql`
        SELECT
          sac.id,
          sac.sage_category_id,
          sac.description as bu_name,
          sac.is_active,
          COUNT(slt.id) as transaction_count,
          COALESCE(SUM(slt.debit), 0) as total_debit,
          COALESCE(SUM(slt.credit), 0) as total_credit
        FROM sage_analysis_categories sac
        LEFT JOIN sage_ledger_transactions slt
          ON slt.sage_bu_category_id = sac.sage_category_id
        WHERE sac.type_code = 'bu'
        GROUP BY sac.id, sac.sage_category_id, sac.description, sac.is_active
        ORDER BY sac.description
      `;

      return apiResponse.success(res, {
        businessUnits,
        total: businessUnits.length,
      });
    } catch (error) {
      logger.error('Failed to get business units', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
}

export default withAuth(handler);
