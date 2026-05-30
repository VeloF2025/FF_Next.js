import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { transaction } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import {
  promoteSerial,
  LifecycleViolationError,
  HolderMismatchError,
} from '@/modules/procurement/field-stock/services/serialLifecycle';
import type { FaultResolutionStatusValue } from '@/types/procurement/fault.types';

const sql = neon(process.env.DATABASE_URL!);

const VALID_RESOLUTION_STATUSES: FaultResolutionStatusValue[] = [
  'open', 'investigating', 'confirmed', 'resolved', 'warranty_claim', 'scrapped',
];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  const user = (req as AuthenticatedNextApiRequest).user;
  const { faultId } = req.query;

  if (!faultId || typeof faultId !== 'string') {
    return apiResponse.badRequest(res, 'Fault report ID is required');
  }

  if (req.method === 'GET') {
    return handleGet(res, faultId);
  } else if (req.method === 'PUT') {
    return handlePut(req, res, faultId, user.id, user.firstName ?? 'System');
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}));

// ============= GET — Single fault report detail =============

async function handleGet(res: NextApiResponse, faultId: string) {
  try {
    const rows = await sql`
      SELECT fr.id, fr.project_id, fr.serial_id, fr.stock_item_id, fr.fault_type,
             fr.severity, fr.resolution_status, fr.description, fr.evidence_urls,
             fr.reported_by, fr.reported_by_name, fr.reported_at, fr.supplier_id,
             fr.location_id, fr.resolved_by, fr.resolved_at, fr.resolution_notes,
             fr.created_at, fr.updated_at,
             si.item_code, si.description AS item_name,
             ss.serial_number, ss.status AS serial_status,
             COALESCE(s.company_name, s.name) AS supplier_name,
             sl.name AS location_name
      FROM fault_reports fr
      LEFT JOIN stock_items si ON fr.stock_item_id = si.id
      LEFT JOIN stock_serials ss ON fr.serial_id = ss.id
      LEFT JOIN suppliers s ON fr.supplier_id = s.id
      LEFT JOIN stock_locations sl ON fr.location_id = sl.id
      WHERE fr.id = ${faultId}::uuid
    `;

    if (rows.length === 0) {
      return apiResponse.notFound(res, 'Fault report', faultId);
    }

    const r = rows[0]!;
    const detail = {
      id: r.id as string,
      projectId: r.project_id as string | undefined,
      serialId: r.serial_id as string | undefined,
      stockItemId: r.stock_item_id as string | undefined,
      itemCode: r.item_code as string | undefined,
      itemName: r.item_name as string | undefined,
      serialNumber: r.serial_number as string | undefined,
      serialStatus: r.serial_status as string | undefined,
      faultType: r.fault_type as string,
      severity: r.severity as string,
      resolutionStatus: r.resolution_status as string,
      description: r.description as string,
      evidenceUrls: r.evidence_urls as string[] | undefined,
      reportedBy: r.reported_by as string,
      reportedByName: r.reported_by_name as string | undefined,
      reportedAt: r.reported_at as string,
      supplierName: r.supplier_name as string | undefined,
      supplierId: r.supplier_id as string | undefined,
      locationId: r.location_id as string | undefined,
      locationName: r.location_name as string | undefined,
      resolvedBy: r.resolved_by as string | undefined,
      resolvedAt: r.resolved_at as string | undefined,
      resolutionNotes: r.resolution_notes as string | undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };

    return apiResponse.success(res, detail);
  } catch (error) {
    log.error('Failed to fetch fault report', { error: { error } }, 'FaultidApi');
    return apiResponse.databaseError(res, error, 'Failed to fetch fault report');
  }
}

// ============= PUT — Update resolution status / notes =============

async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  faultId: string,
  userId: string,
  userName: string,
) {
  try {
    const body = req.body;

    // Validate resolution_status if provided (before opening a transaction)
    if (body.resolutionStatus && !VALID_RESOLUTION_STATUSES.includes(body.resolutionStatus)) {
      return apiResponse.validationError(res, {
        resolutionStatus: `Must be one of: ${VALID_RESOLUTION_STATUSES.join(', ')}`,
      });
    }

    // Fault-report update + serial promotion are one atomic unit (Track 7): the
    // serial status routes through promoteSerial so the mig 387 emit trigger
    // records the lifecycle event. fault_report_id is non-status metadata, so it
    // stays a plain UPDATE.
    const outcome = await transaction(async (txn) => {
      const oldRow = await txn.queryOne<{ resolution_status: string; serial_id: string | null }>(
        `SELECT id, resolution_status, serial_id FROM fault_reports WHERE id = $1::uuid`,
        [faultId],
      );
      if (!oldRow) {
        return null;
      }

      const newStatus = body.resolutionStatus ?? oldRow.resolution_status;
      const isResolving = newStatus === 'resolved' || newStatus === 'scrapped';

      const updated = await txn.queryOne(
        `UPDATE fault_reports
            SET resolution_status = $1,
                resolution_notes  = COALESCE($2, resolution_notes),
                resolved_by        = CASE WHEN $3 THEN $4 ELSE resolved_by END,
                resolved_at        = CASE WHEN $3 THEN NOW() ELSE resolved_at END,
                updated_at         = NOW()
          WHERE id = $5::uuid
          RETURNING id, project_id, serial_id, stock_item_id, fault_type, severity,
                    resolution_status, description, evidence_urls, reported_by,
                    reported_by_name, reported_at, supplier_id, location_id,
                    resolved_by, resolved_at, resolution_notes, created_at, updated_at`,
        [newStatus, body.resolutionNotes ?? null, isResolving, userName, faultId],
      );

      // Resolving a fault clears the unit back to stock (faulty→in_stock) or
      // scraps it (faulty→scrapped). Both clear the holder (warehouse-resident).
      if (isResolving && oldRow.serial_id) {
        const toStatus = newStatus === 'scrapped' ? 'scrapped' : 'in_stock';
        await promoteSerial(txn.client, {
          serialId:    oldRow.serial_id,
          toStatus,
          toHolderId:  null,
          sourceTable: 'fault_reports',
          sourceId:    faultId,
          actorUserId: userId,
          payload: { resolution_status: newStatus },
        });
        // Cleared back to stock → drop the fault link (metadata only).
        if (toStatus === 'in_stock') {
          await txn.query(
            `UPDATE stock_serials SET fault_report_id = NULL WHERE id = $1::uuid`,
            [oldRow.serial_id],
          );
        }
      }

      return { updated, newStatus, oldStatus: oldRow.resolution_status };
    });

    if (!outcome) {
      return apiResponse.notFound(res, 'Fault report', faultId);
    }

    // Audit log
    createAuditLog({
      entityType: 'fault_report',
      entityId: faultId,
      action: 'update',
      performedBy: userId,
      performedByName: userName,
      oldValues: { resolutionStatus: outcome.oldStatus },
      newValues: { resolutionStatus: outcome.newStatus },
      changedFields: ['resolution_status'],
    });

    if (!outcome.updated) {
      return apiResponse.notFound(res, 'Fault report', faultId);
    }

    log.info('[FaultReports] Updated fault report', {
      data: { id: faultId, newStatus: outcome.newStatus },
    }, 'fault-reports');

    return apiResponse.success(res, outcome.updated, 'Fault report updated');
  } catch (error) {
    if (error instanceof LifecycleViolationError || error instanceof HolderMismatchError) {
      log.warn('fault-reports.resolve.lifecycle_rejected', { error: error.message }, 'fault-reports');
      return apiResponse.validationError(res, { serial: error.message });
    }
    log.error('Failed to update fault report', { error: { error } }, 'FaultidApi');
    return apiResponse.databaseError(res, error, 'Failed to update fault report');
  }
}
