/**
 * Spare Usage API
 * POST /api/projects/[projectId]/spare-usage - Record spare drop consumption
 * GET /api/projects/[projectId]/spare-usage - List spare usage log
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { SpareUsageReason } from '@/types/finance';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

const VALID_REASONS: SpareUsageReason[] = [
  'failed_drop', 'damaged_ont', 'customer_relocation',
  'signal_quality', 'construction_issue', 'other',
];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List spare usage log
  if (req.method === 'GET') {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const entries = await sql`
        SELECT
          sul.id, sul.spare_drop_number, sul.replaced_drop_number,
          sul.reason, sul.notes, sul.recorded_by, sul.recorded_at,
          sul.client_po_id, cpo.po_number as client_po_number
        FROM spare_usage_log sul
        LEFT JOIN client_purchase_orders cpo ON cpo.id = sul.client_po_id
        WHERE sul.project_id = ${projectId}
        ORDER BY sul.recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM spare_usage_log
        WHERE project_id = ${projectId}
      `;

      return apiResponse.success(res, {
        entries: entries.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          spareDropNumber: row.spare_drop_number as string,
          replacedDropNumber: row.replaced_drop_number as string | undefined,
          reason: row.reason as string,
          notes: row.notes as string | undefined,
          recordedBy: row.recorded_by as string,
          recordedAt: row.recorded_at as string,
          clientPoId: row.client_po_id as string | undefined,
          clientPoNumber: row.client_po_number as string | undefined,
        })),
        total: Number(countResult[0]?.total || 0),
      });
    } catch (error) {
      log.error('Failed to fetch spare usage log', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch spare usage log');
    }
  }

  // POST - Record spare consumption
  if (req.method === 'POST') {
    try {
      const {
        spareDropId,
        replacedDropId,
        reason,
        notes,
        clientPoId,
      } = req.body as {
        spareDropId: string;
        replacedDropId?: string;
        reason: SpareUsageReason;
        notes?: string;
        clientPoId?: string;
      };

      // Validate required fields
      if (!spareDropId) {
        return apiResponse.validationError(res, { spareDropId: 'Spare drop ID is required' });
      }
      if (!reason || !VALID_REASONS.includes(reason)) {
        return apiResponse.validationError(res, { reason: `Reason must be one of: ${VALID_REASONS.join(', ')}` });
      }

      // Verify spare drop exists and is marked as spare
      const spareDrop = await sql`
        SELECT id, drop_number, is_spare, project_id, client_po_id
        FROM drops
        WHERE id = ${spareDropId} AND project_id = ${projectId}
      `;

      if (spareDrop.length === 0 || !spareDrop[0]) {
        return apiResponse.notFound(res, 'Spare drop', spareDropId);
      }

      if (!spareDrop[0].is_spare) {
        return apiResponse.badRequest(res, 'Drop is not marked as a spare');
      }

      // Get replaced drop info if provided
      let replacedDropNumber: string | null = null;
      if (replacedDropId) {
        const replacedDrop = await sql`
          SELECT drop_number FROM drops
          WHERE id = ${replacedDropId} AND project_id = ${projectId}
        `;
        replacedDropNumber = (replacedDrop[0]?.drop_number as string) || null;
      }

      // Determine client_po_id (from body or from the spare drop itself)
      const effectivePoId = clientPoId || spareDrop[0].client_po_id;

      // Insert usage log
      const result = await sql`
        INSERT INTO spare_usage_log (
          project_id, client_po_id, spare_drop_id, spare_drop_number,
          replaced_drop_id, replaced_drop_number,
          reason, notes, recorded_by
        ) VALUES (
          ${projectId},
          ${effectivePoId || null},
          ${spareDropId},
          ${spareDrop[0].drop_number as string},
          ${replacedDropId || null},
          ${replacedDropNumber},
          ${reason},
          ${notes || null},
          ${userId || 'system'}
        )
        RETURNING *
      `;

      const entry = result[0];

      log.info('Spare usage recorded', {
        projectId,
        spareDropId,
        reason,
        entryId: entry?.id,
      });

      return apiResponse.created(res, {
        entry: {
          id: entry?.id as string,
          spareDropNumber: entry?.spare_drop_number as string,
          replacedDropNumber: entry?.replaced_drop_number as string | undefined,
          reason: entry?.reason as string,
          notes: entry?.notes as string | undefined,
          recordedBy: entry?.recorded_by as string,
          recordedAt: entry?.recorded_at as string,
        },
      });
    } catch (error) {
      log.error('Failed to record spare usage', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to record spare usage');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));
