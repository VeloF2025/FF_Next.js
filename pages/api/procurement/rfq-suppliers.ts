/**
 * GET /api/procurement/rfq-suppliers?rfqId=xxx
 * Returns suppliers invited to an RFQ with their company names.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { rfqId } = req.query;
  if (!rfqId || typeof rfqId !== 'string') {
    return apiResponse.badRequest(res, 'rfqId is required');
  }

  const rows = await sql`
    SELECT
      rs.supplier_id,
      s.company_name AS supplier_name,
      rs.status
    FROM rfq_suppliers rs
    LEFT JOIN suppliers s ON rs.supplier_id = s.id
    WHERE rs.rfq_id = ${rfqId}
    ORDER BY s.company_name
  `;

  return apiResponse.success(res, rows);
}));
