/**
 * Assign Drops to Client PO API
 * POST /api/projects/[projectId]/client-pos/[poId]/assign-drops
 * DELETE /api/projects/[projectId]/client-pos/[poId]/assign-drops - Unassign drops
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AssignDropsInput, AssignDropsResult } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const poId = req.query.poId as string;

  if (!projectId || !poId) {
    return apiResponse.badRequest(res, 'Project ID and PO ID are required');
  }

  // Verify Client PO exists and is active/draft
  const clientPO = await sql`
    SELECT * FROM client_purchase_orders
    WHERE id = ${poId} AND project_id = ${projectId}
  `;

  if (clientPO.length === 0 || !clientPO[0]) {
    return apiResponse.notFound(res, 'Client PO', poId);
  }

  const po = clientPO[0];
  if (po.status === 'cancelled' || po.status === 'completed') {
    return apiResponse.forbidden(res, 'Cannot modify drops on cancelled or completed PO');
  }

  // POST - Assign drops to Client PO
  if (req.method === 'POST') {
    try {
      const body = req.body as AssignDropsInput;

      if (!body.dropIds || !Array.isArray(body.dropIds) || body.dropIds.length === 0) {
        return apiResponse.validationError(res, { dropIds: 'Drop IDs array is required' });
      }

      const result: AssignDropsResult = {
        assigned: 0,
        alreadyAssigned: 0,
        errors: [],
      };

      // Verify all drops belong to the project and check current assignment
      const drops = await sql`
        SELECT id, drop_number, client_po_id, invoiced
        FROM drops
        WHERE id = ANY(${body.dropIds}::uuid[])
        AND project_id = ${projectId}
      `;

      const foundIds = new Set(drops.map(d => d.id));

      // Check for missing drops
      for (const dropId of body.dropIds) {
        if (!foundIds.has(dropId)) {
          result.errors.push(`Drop ${dropId} not found in project`);
        }
      }

      // Filter drops that can be assigned
      const dropsToAssign: string[] = [];
      for (const drop of drops) {
        if (drop.invoiced) {
          result.errors.push(`Drop ${drop.drop_number} is already invoiced`);
        } else if (drop.client_po_id === poId) {
          result.alreadyAssigned++;
        } else if (drop.client_po_id) {
          result.errors.push(`Drop ${drop.drop_number} is assigned to another PO`);
        } else {
          dropsToAssign.push(drop.id);
        }
      }

      // Assign drops
      if (dropsToAssign.length > 0) {
        await sql`
          UPDATE drops
          SET client_po_id = ${poId}
          WHERE id = ANY(${dropsToAssign}::uuid[])
        `;
        result.assigned = dropsToAssign.length;
      }

      log.info('Drops assigned to Client PO', {
        clientPoId: poId,
        projectId,
        assigned: result.assigned,
        alreadyAssigned: result.alreadyAssigned,
        errors: result.errors.length,
      });

      return apiResponse.success(res, { result });
    } catch (error) {
      log.error('Failed to assign drops', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to assign drops');
    }
  }

  // DELETE - Unassign drops from Client PO
  if (req.method === 'DELETE') {
    try {
      const body = req.body as AssignDropsInput;

      if (!body.dropIds || !Array.isArray(body.dropIds) || body.dropIds.length === 0) {
        return apiResponse.validationError(res, { dropIds: 'Drop IDs array is required' });
      }

      // Only unassign drops that are assigned to THIS PO and not invoiced
      const result = await sql`
        UPDATE drops
        SET client_po_id = NULL
        WHERE id = ANY(${body.dropIds}::uuid[])
        AND client_po_id = ${poId}
        AND invoiced = false
        RETURNING id
      `;

      log.info('Drops unassigned from Client PO', {
        clientPoId: poId,
        projectId,
        unassigned: result.length,
      });

      return apiResponse.success(res, {
        unassigned: result.length,
        requestedCount: body.dropIds.length,
      });
    } catch (error) {
      log.error('Failed to unassign drops', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to unassign drops');
    }
  }

  // GET - List drops assigned to this PO
  if (req.method === 'GET') {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const includeActivated = req.query.activated !== 'false';
      const onlyUninvoiced = req.query.uninvoiced === 'true';

      let whereConditions = sql`WHERE d.client_po_id = ${poId}`;
      if (!includeActivated) {
        whereConditions = sql`${whereConditions} AND oa.id IS NULL`;
      }
      if (onlyUninvoiced) {
        whereConditions = sql`${whereConditions} AND d.invoiced = false`;
      }

      const drops = await sql`
        SELECT
          d.id,
          d.drop_number,
          d.lid,
          d.address,
          d.invoiced,
          d.invoice_id,
          oa.activation_date,
          oa.id as oes_activation_id
        FROM drops d
        LEFT JOIN oes_activations oa ON oa.drop_id = d.id
        ${whereConditions}
        ORDER BY d.drop_number
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM drops d
        LEFT JOIN oes_activations oa ON oa.drop_id = d.id
        ${whereConditions}
      `;

      const total = Number(countResult[0]?.total || 0);

      return apiResponse.success(res, {
        drops: drops.map(d => ({
          id: d.id,
          dropNumber: d.drop_number,
          lid: d.lid,
          address: d.address,
          invoiced: d.invoiced,
          invoiceId: d.invoice_id,
          activationDate: d.activation_date,
          oesActivationId: d.oes_activation_id,
          isActivated: !!d.activation_date,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      log.error('Failed to fetch assigned drops', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch assigned drops');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
}));
