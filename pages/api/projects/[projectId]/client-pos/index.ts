/**
 * Client Purchase Order API - List and Create
 * GET /api/projects/[projectId]/client-pos - List Client POs
 * POST /api/projects/[projectId]/client-pos - Create Client PO
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { ClientPurchaseOrder, ClientPOCreateInput } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { normalizeStorageUrl } from '@/services/vfStorageAdapter';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withRole('super_admin')(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List Client POs
  if (req.method === 'GET') {
    try {
      const status = req.query.status as string | undefined;

      // Get live activation count for the project from oes_activations
      const activationsResult = await sql`
        SELECT COUNT(*) as total_activated
        FROM oes_activations oa
        INNER JOIN drops d ON d.id = oa.drop_id
        WHERE d.project_id = ${projectId}
      `;
      const liveActivatedCount = Number(activationsResult[0]?.total_activated || 0);


      // Query with optional status filter - avoid empty sql fragments
      const clientPOs = status
        ? await sql`
            SELECT cpo.*, c.company_name as client_name, p.project_name as project_name
            FROM client_purchase_orders cpo
            LEFT JOIN clients c ON c.id = cpo.client_id
            LEFT JOIN projects p ON p.id = cpo.project_id
            WHERE cpo.project_id = ${projectId} AND cpo.status = ${status}
            ORDER BY cpo.created_at DESC
          `
        : await sql`
            SELECT cpo.*, c.company_name as client_name, p.project_name as project_name
            FROM client_purchase_orders cpo
            LEFT JOIN clients c ON c.id = cpo.client_id
            LEFT JOIN projects p ON p.id = cpo.project_id
            WHERE cpo.project_id = ${projectId}
            ORDER BY cpo.created_at DESC
          `;

      // For single PO projects, use the live activation count
      // For multi-PO projects, this distributes based on contracted ratio (simplified approach)
      const totalContracted = clientPOs.reduce((sum: number, po: Record<string, unknown>) => sum + Number(po.contracted_drops || 0), 0);
      const posWithLiveCounts = clientPOs.map((po: Record<string, unknown>) => {
        if (clientPOs.length === 1) {
          // Single PO gets all activations
          return { ...po, drops_activated: liveActivatedCount };
        } else {
          // Multi-PO: distribute proportionally (for now, use stored value if available)
          const ratio = totalContracted > 0 ? Number(po.contracted_drops || 0) / totalContracted : 0;
          return { ...po, drops_activated: Math.round(liveActivatedCount * ratio) };
        }
      });

      return apiResponse.success(res, {
        clientPOs: posWithLiveCounts.map(transformClientPO),
        count: posWithLiveCounts.length,
      });
    } catch (error) {
      log.error('Failed to fetch Client POs', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch Client POs');
    }
  }

  // POST - Create Client PO
  if (req.method === 'POST') {
    try {
      const body = req.body as ClientPOCreateInput;

      // Validation
      if (!body.poNumber) {
        return apiResponse.validationError(res, { poNumber: 'PO number is required' });
      }
      if (!body.contractedDrops || body.contractedDrops <= 0) {
        return apiResponse.validationError(res, { contractedDrops: 'Contracted drops must be greater than 0' });
      }
      if (!body.pricePerDrop || body.pricePerDrop <= 0) {
        return apiResponse.validationError(res, { pricePerDrop: 'Price per drop must be greater than 0' });
      }
      if (!body.poDate) {
        return apiResponse.validationError(res, { poDate: 'PO date is required' });
      }

      // Get project's client if not provided
      let clientId = body.clientId;
      if (!clientId) {
        const projectResult = await sql`
          SELECT client_id FROM projects WHERE id = ${projectId}
        `;
        if (!projectResult[0]?.client_id) {
          return apiResponse.validationError(res, { clientId: 'Project has no client assigned. Please specify a client.' });
        }
        clientId = projectResult[0].client_id;
      }

      // Check for duplicate PO number
      const existing = await sql`
        SELECT id FROM client_purchase_orders
        WHERE project_id = ${projectId} AND po_number = ${body.poNumber}
      `;
      if (existing.length > 0) {
        return apiResponse.conflict(res, `Client PO with number ${body.poNumber} already exists for this project`);
      }

      // Calculate total value
      const totalValue = body.contractedDrops * body.pricePerDrop;

      // Create Client PO (with optional source document from PDF import)
      const result = await sql`
        INSERT INTO client_purchase_orders (
          po_number, reference, project_id, client_id,
          contracted_drops, price_per_drop, total_value,
          po_date, valid_from, valid_to,
          tax_rate, tax_inclusive,
          description, terms,
          source_document_url, source_document_name,
          vlm_extraction_data, vlm_confidence_score,
          status, created_by
        ) VALUES (
          ${body.poNumber},
          ${body.reference || null},
          ${projectId},
          ${clientId},
          ${body.contractedDrops},
          ${body.pricePerDrop},
          ${totalValue},
          ${body.poDate},
          ${body.validFrom || null},
          ${body.validTo || null},
          ${body.taxRate ?? 15},
          ${body.taxInclusive ?? false},
          ${body.description || null},
          ${body.terms || null},
          ${body.sourceDocumentUrl || null},
          ${body.sourceDocumentName || null},
          ${body.vlmExtractionData ? JSON.stringify(body.vlmExtractionData) : null},
          ${body.vlmConfidenceScore || null},
          'active',
          ${userId || 'system'}
        )
        RETURNING *
      `;

      const newPO = result[0];
      if (!newPO) {
        return apiResponse.internalError(res, new Error('Failed to create Client PO'));
      }

      // Get with joined data
      const created = await sql`
        SELECT
          cpo.*,
          c.company_name as client_name,
          p.project_name as project_name
        FROM client_purchase_orders cpo
        LEFT JOIN clients c ON c.id = cpo.client_id
        LEFT JOIN projects p ON p.id = cpo.project_id
        WHERE cpo.id = ${newPO.id}
      `;

      log.info('Client PO created', {
        clientPoId: newPO.id,
        poNumber: body.poNumber,
        projectId,
        totalValue,
      });

      return apiResponse.created(res, {
        clientPO: transformClientPO(created[0] || newPO),
      });
    } catch (error) {
      log.error('Failed to create Client PO', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to create Client PO');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
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
    sourceDocumentUrl: normalizeStorageUrl(row.source_document_url as string | undefined),
    sourceDocumentName: row.source_document_name as string | undefined,
    vlmExtractionData: row.vlm_extraction_data as Record<string, unknown> | undefined,
    vlmConfidenceScore: row.vlm_confidence_score ? Number(row.vlm_confidence_score) : undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    clientName: row.client_name as string | undefined,
    projectName: row.project_name as string | undefined,
  };
}
