/**
 * Client Purchase Order API - Get, Update, Delete
 * GET /api/projects/[projectId]/client-pos/[poId] - Get Client PO detail
 * PATCH /api/projects/[projectId]/client-pos/[poId] - Update Client PO
 * DELETE /api/projects/[projectId]/client-pos/[poId] - Delete Client PO (draft only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { ClientPurchaseOrder, ClientPOUpdateInput, ClientPOProgress } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withRole('super_admin')(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const poId = req.query.poId as string;

  if (!projectId || !poId) {
    return apiResponse.badRequest(res, 'Project ID and PO ID are required');
  }

  // GET - Get Client PO detail with progress
  if (req.method === 'GET') {
    try {
      const result = await sql`
        SELECT
          cpo.id, cpo.po_number, cpo.reference, cpo.project_id, cpo.client_id,
          cpo.contracted_drops, cpo.price_per_drop, cpo.total_value,
          cpo.drops_assigned, cpo.drops_activated, cpo.amount_invoiced, cpo.amount_paid,
          cpo.spares_allocated, cpo.spares_used, cpo.status,
          cpo.po_date, cpo.valid_from, cpo.valid_to,
          cpo.tax_rate, cpo.tax_inclusive, cpo.description, cpo.terms,
          cpo.created_by, cpo.created_at, cpo.updated_at,
          c.company_name as client_name,
          p.project_name as project_name
        FROM client_purchase_orders cpo
        LEFT JOIN clients c ON c.id = cpo.client_id
        LEFT JOIN projects p ON p.id = cpo.project_id
        WHERE cpo.id = ${poId} AND cpo.project_id = ${projectId}
      `;

      if (result.length === 0 || !result[0]) {
        return apiResponse.notFound(res, 'Client PO', poId);
      }

      const clientPO = transformClientPO(result[0] as Record<string, unknown>);
      const progress = calculateProgress(clientPO);

      // Get assigned drops summary
      const dropsSummary = await sql`
        SELECT
          COUNT(*) as total_assigned,
          COUNT(*) FILTER (WHERE oa.id IS NOT NULL) as total_activated,
          COUNT(*) FILTER (WHERE d.invoiced = true) as total_invoiced
        FROM drops d
        LEFT JOIN oes_activations oa ON oa.drop_id = d.id
        WHERE d.client_po_id = ${poId}
      `;

      // Spare summary: derived from total project drops - total PO contracted
      const spareCalcResult = await sql`
        SELECT
          (SELECT COUNT(*) FROM drops WHERE project_id = ${projectId}) as total_project_drops,
          (SELECT COALESCE(SUM(contracted_drops), 0) FROM client_purchase_orders
           WHERE project_id = ${projectId} AND status != 'cancelled') as total_contracted
      `;
      const totalProjectDrops = Number(spareCalcResult[0]?.total_project_drops || 0);
      const totalContracted = Number(spareCalcResult[0]?.total_contracted || 0);
      const projectSpares = Math.max(0, totalProjectDrops - totalContracted);

      // Get recent spare usage log for this PO (or project-level if no PO assignment)
      const usageLog = await sql`
        SELECT
          id, spare_drop_number, replaced_drop_number,
          reason, notes, recorded_by, recorded_at
        FROM spare_usage_log
        WHERE project_id = ${projectId}
          AND (client_po_id = ${poId} OR client_po_id IS NULL)
        ORDER BY recorded_at DESC
        LIMIT 10
      `;

      return apiResponse.success(res, {
        clientPO,
        progress,
        dropsSummary: {
          totalAssigned: Number(dropsSummary[0]?.total_assigned || 0),
          totalActivated: Number(dropsSummary[0]?.total_activated || 0),
          totalInvoiced: Number(dropsSummary[0]?.total_invoiced || 0),
        },
        spareSummary: {
          sparesAllocated: projectSpares,
          sparesUsed: 0,
          sparesAvailable: projectSpares,
        },
        spareUsageLog: usageLog.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          spareDropNumber: row.spare_drop_number as string,
          replacedDropNumber: row.replaced_drop_number as string | undefined,
          reason: row.reason as string,
          notes: row.notes as string | undefined,
          recordedBy: row.recorded_by as string,
          recordedAt: row.recorded_at as string,
        })),
      });
    } catch (error) {
      log.error('Failed to fetch Client PO', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch Client PO');
    }
  }

  // PATCH - Update Client PO
  if (req.method === 'PATCH') {
    try {
      const body = req.body as ClientPOUpdateInput;

      // Get existing
      const existing = await sql`
        SELECT id, status, total_value, contracted_drops, price_per_drop
        FROM client_purchase_orders
        WHERE id = ${poId} AND project_id = ${projectId}
      `;

      if (existing.length === 0 || !existing[0]) {
        return apiResponse.notFound(res, 'Client PO', poId);
      }

      const currentPO = existing[0];

      // Only allow certain updates on non-draft POs
      if (currentPO.status !== 'draft' && (
        body.contractedDrops !== undefined ||
        body.pricePerDrop !== undefined ||
        body.poNumber !== undefined
      )) {
        return apiResponse.forbidden(res, 'Cannot modify contracted scope on active/completed PO');
      }

      // Calculate new total value if pricing changed
      let totalValue = currentPO.total_value;
      if (body.contractedDrops !== undefined || body.pricePerDrop !== undefined) {
        const drops = body.contractedDrops ?? currentPO.contracted_drops;
        const price = body.pricePerDrop ?? currentPO.price_per_drop;
        totalValue = drops * price;
      }

      // Update
      const result = await sql`
        UPDATE client_purchase_orders
        SET
          po_number = COALESCE(${body.poNumber}, po_number),
          reference = COALESCE(${body.reference}, reference),
          contracted_drops = COALESCE(${body.contractedDrops}, contracted_drops),
          price_per_drop = COALESCE(${body.pricePerDrop}, price_per_drop),
          total_value = ${totalValue},
          po_date = COALESCE(${body.poDate}, po_date),
          valid_from = COALESCE(${body.validFrom}, valid_from),
          valid_to = COALESCE(${body.validTo}, valid_to),
          tax_rate = COALESCE(${body.taxRate}, tax_rate),
          tax_inclusive = COALESCE(${body.taxInclusive}, tax_inclusive),
          description = COALESCE(${body.description}, description),
          terms = COALESCE(${body.terms}, terms),
          status = COALESCE(${body.status}, status),
          updated_at = NOW()
        WHERE id = ${poId}
        RETURNING id
      `;

      const updated = result[0];
      if (!updated) {
        return apiResponse.internalError(res, new Error('Failed to update Client PO'));
      }

      // Get with joined data
      const refreshed = await sql`
        SELECT
          cpo.id, cpo.po_number, cpo.reference, cpo.project_id, cpo.client_id,
          cpo.contracted_drops, cpo.price_per_drop, cpo.total_value,
          cpo.drops_assigned, cpo.drops_activated, cpo.amount_invoiced, cpo.amount_paid,
          cpo.spares_allocated, cpo.spares_used, cpo.status,
          cpo.po_date, cpo.valid_from, cpo.valid_to,
          cpo.tax_rate, cpo.tax_inclusive, cpo.description, cpo.terms,
          cpo.created_by, cpo.created_at, cpo.updated_at,
          c.company_name as client_name,
          p.project_name as project_name
        FROM client_purchase_orders cpo
        LEFT JOIN clients c ON c.id = cpo.client_id
        LEFT JOIN projects p ON p.id = cpo.project_id
        WHERE cpo.id = ${poId}
      `;

      log.info('Client PO updated', { clientPoId: poId, projectId });

      return apiResponse.success(res, {
        clientPO: transformClientPO(refreshed[0] || updated),
      });
    } catch (error) {
      log.error('Failed to update Client PO', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to update Client PO');
    }
  }

  // DELETE - Delete draft Client PO
  if (req.method === 'DELETE') {
    try {
      // Check if draft
      const existing = await sql`
        SELECT status, drops_assigned FROM client_purchase_orders
        WHERE id = ${poId} AND project_id = ${projectId}
      `;

      if (existing.length === 0 || !existing[0]) {
        return apiResponse.notFound(res, 'Client PO', poId);
      }

      const existingPO = existing[0];
      if (existingPO.status !== 'draft') {
        return apiResponse.forbidden(res, 'Only draft Client POs can be deleted');
      }

      if (Number(existingPO.drops_assigned) > 0) {
        return apiResponse.forbidden(res, 'Cannot delete Client PO with assigned drops');
      }

      await sql`DELETE FROM client_purchase_orders WHERE id = ${poId}`;

      log.info('Client PO deleted', { clientPoId: poId, projectId });

      return apiResponse.success(res, { deleted: true });
    } catch (error) {
      log.error('Failed to delete Client PO', { projectId, poId, error });
      return apiResponse.databaseError(res, error, 'Failed to delete Client PO');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
})));

function transformClientPO(row: Record<string, unknown>): ClientPurchaseOrder {
  return {
    id: row.id as string,
    poNumber: row.po_number as string,
    reference: row.reference as string | undefined,
    projectId: row.project_id as string,
    clientId: row.client_id as string,
    contractedDrops: Number(row.contracted_drops),
    pricePerDrop: Number(row.price_per_drop),
    totalValue: Number(row.total_value),
    dropsAssigned: Number(row.drops_assigned || 0),
    dropsActivated: Number(row.drops_activated || 0),
    amountInvoiced: Number(row.amount_invoiced || 0),
    amountPaid: Number(row.amount_paid || 0),
    sparesAllocated: Number(row.spares_allocated || 0),
    sparesUsed: Number(row.spares_used || 0),
    status: row.status as ClientPurchaseOrder['status'],
    poDate: row.po_date as string,
    validFrom: row.valid_from as string | undefined,
    validTo: row.valid_to as string | undefined,
    taxRate: Number(row.tax_rate),
    taxInclusive: row.tax_inclusive as boolean,
    description: row.description as string | undefined,
    terms: row.terms as string | undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    clientName: row.client_name as string | undefined,
    projectName: row.project_name as string | undefined,
  };
}

function calculateProgress(po: ClientPurchaseOrder): ClientPOProgress {
  const assignedPercent = po.contractedDrops > 0
    ? Math.round((po.dropsAssigned / po.contractedDrops) * 100 * 100) / 100
    : 0;
  const activatedPercent = po.contractedDrops > 0
    ? Math.round((po.dropsActivated / po.contractedDrops) * 100 * 100) / 100
    : 0;
  const invoicedPercent = po.totalValue > 0
    ? Math.round((po.amountInvoiced / po.totalValue) * 100 * 100) / 100
    : 0;
  const paidPercent = po.amountInvoiced > 0
    ? Math.round((po.amountPaid / po.amountInvoiced) * 100 * 100) / 100
    : 0;

  return {
    assignedPercent,
    activatedPercent,
    invoicedPercent,
    paidPercent,
    remainingDrops: Math.max(0, po.contractedDrops - po.dropsActivated),
    remainingValue: Math.max(0, po.totalValue - po.amountInvoiced),
  };
}
