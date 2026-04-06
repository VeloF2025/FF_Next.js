/**
 * Contractor Payment Totals API
 *
 * GET /api/contractors/[contractorId]/payments/totals
 *     Returns aggregated total paid per contractor_project_id for this contractor.
 *     Also returns the grand total across all projects.
 *
 * Response:
 * {
 *   grandTotal: number,
 *   byProject: { [contractorProjectId: string]: number }
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

interface TotalsRow {
  contractor_project_id: string | null;
  total: string;
}

interface TotalsResponse {
  grandTotal: number;
  byProject: Record<string, number>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }

  try {
    const [contractorExists] = await sql`
      SELECT id FROM contractors WHERE id = ${contractorId}
    `;
    if (!contractorExists) {
      return apiResponse.notFound(res, 'Contractor not found');
    }

    const rows = (await sql`
      SELECT contractor_project_id, SUM(amount) AS total
      FROM contractor_payments
      WHERE contractor_id = ${contractorId}
      GROUP BY contractor_project_id
    `) as unknown as TotalsRow[];

    let grandTotal = 0;
    const byProject: Record<string, number> = {};

    for (const row of rows) {
      const amount = Number(row.total);
      grandTotal += amount;
      if (row.contractor_project_id !== null) {
        byProject[row.contractor_project_id] = amount;
      }
    }

    const response: TotalsResponse = { grandTotal, byProject };
    return res.status(200).json(response);
  } catch (error) {
    log.error('Error fetching contractor payment totals', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to fetch payment totals'));
  }
}

export default withAuth(handler);
