/**
 * Uninvoiced Drops API
 * GET /api/projects/[projectId]/drops/uninvoiced - Get uninvoiced activated drops
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { UninvoicedDrop } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const clientPoId = req.query.clientPoId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    // Get uninvoiced activated drops
    const drops = await sql`
      SELECT
        d.id as drop_id,
        d.drop_number,
        d.lid,
        d.address,
        d.client_po_id,
        cpo.po_number as client_po_number,
        oa.activation_date::DATE as activation_date,
        COALESCE(cpo.price_per_drop, 0) as price_per_drop
      FROM drops d
      INNER JOIN oes_activations oa ON oa.drop_id = d.id
      LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
      WHERE d.project_id = ${projectId}
        AND d.invoiced = false
        ${clientPoId ? sql`AND d.client_po_id = ${clientPoId}` : sql``}
        ${startDate ? sql`AND oa.activation_date >= ${startDate}` : sql``}
        ${endDate ? sql`AND oa.activation_date <= ${endDate}` : sql``}
      ORDER BY oa.activation_date DESC, d.drop_number
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Get count
    const countResult = await sql`
      SELECT COUNT(*) as total
      FROM drops d
      INNER JOIN oes_activations oa ON oa.drop_id = d.id
      WHERE d.project_id = ${projectId}
        AND d.invoiced = false
        ${clientPoId ? sql`AND d.client_po_id = ${clientPoId}` : sql``}
        ${startDate ? sql`AND oa.activation_date >= ${startDate}` : sql``}
        ${endDate ? sql`AND oa.activation_date <= ${endDate}` : sql``}
    `;

    const total = Number(countResult[0]?.total || 0);

    // Get summary by Client PO
    const poSummary = await sql`
      SELECT
        d.client_po_id,
        cpo.po_number as client_po_number,
        cpo.price_per_drop,
        COUNT(*) as drop_count,
        SUM(COALESCE(cpo.price_per_drop, 0)) as total_value
      FROM drops d
      INNER JOIN oes_activations oa ON oa.drop_id = d.id
      LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
      WHERE d.project_id = ${projectId}
        AND d.invoiced = false
        ${startDate ? sql`AND oa.activation_date >= ${startDate}` : sql``}
        ${endDate ? sql`AND oa.activation_date <= ${endDate}` : sql``}
      GROUP BY d.client_po_id, cpo.po_number, cpo.price_per_drop
      ORDER BY drop_count DESC
    `;

    return apiResponse.success(res, {
      drops: drops.map(d => ({
        dropId: d.drop_id,
        dropNumber: d.drop_number,
        lid: d.lid,
        address: d.address,
        clientPoId: d.client_po_id,
        clientPoNumber: d.client_po_number,
        activationDate: d.activation_date,
        pricePerDrop: Number(d.price_per_drop),
      } as UninvoicedDrop)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalDrops: total,
        totalValue: drops.reduce((sum, d) => sum + Number(d.price_per_drop), 0),
        byClientPO: poSummary.map(p => ({
          clientPoId: p.client_po_id,
          clientPoNumber: p.client_po_number,
          pricePerDrop: Number(p.price_per_drop),
          dropCount: Number(p.drop_count),
          totalValue: Number(p.total_value),
        })),
      },
    });
  } catch (error) {
    log.error('Failed to fetch uninvoiced drops', { projectId, error });
    return apiResponse.databaseError(res, error, 'Failed to fetch uninvoiced drops');
  }
}));
