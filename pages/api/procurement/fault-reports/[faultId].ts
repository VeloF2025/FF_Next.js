import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
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
      SELECT fr.*,
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

    // Fetch current state
    const current = await sql`
      SELECT * FROM fault_reports WHERE id = ${faultId}::uuid
    `;
    if (current.length === 0) {
      return apiResponse.notFound(res, 'Fault report', faultId);
    }
    const oldRow = current[0]!;

    // Validate resolution_status if provided
    if (body.resolutionStatus && !VALID_RESOLUTION_STATUSES.includes(body.resolutionStatus)) {
      return apiResponse.validationError(res, {
        resolutionStatus: `Must be one of: ${VALID_RESOLUTION_STATUSES.join(', ')}`,
      });
    }

    const newStatus = body.resolutionStatus ?? oldRow.resolution_status;
    const isResolving = newStatus === 'resolved' || newStatus === 'scrapped';

    const [updated] = await sql`
      UPDATE fault_reports
      SET resolution_status = ${newStatus},
          resolution_notes  = COALESCE(${body.resolutionNotes ?? null}, resolution_notes),
          resolved_by        = CASE WHEN ${isResolving} THEN ${userName} ELSE resolved_by END,
          resolved_at        = CASE WHEN ${isResolving} THEN NOW() ELSE resolved_at END,
          updated_at         = NOW()
      WHERE id = ${faultId}::uuid
      RETURNING *
    `;

    // If resolved/scrapped and serial exists, update serial status accordingly
    if (isResolving && oldRow.serial_id) {
      const newSerialStatus = newStatus === 'scrapped' ? 'scrapped' : 'available';
      await sql`
        UPDATE stock_serials
        SET previous_status   = status,
            status            = ${newSerialStatus},
            status_changed_at = NOW(),
            status_changed_by = ${userName},
            fault_report_id   = CASE WHEN ${newSerialStatus} = 'available' THEN NULL ELSE fault_report_id END
        WHERE id = ${oldRow.serial_id}::uuid
      `;
    }

    // Audit log
    createAuditLog({
      entityType: 'fault_report',
      entityId: faultId,
      action: 'update',
      performedBy: userId,
      performedByName: userName,
      oldValues: { resolutionStatus: oldRow.resolution_status },
      newValues: { resolutionStatus: newStatus },
      changedFields: ['resolution_status'],
    });

    log.info('[FaultReports] Updated fault report', {
      data: { id: faultId, newStatus },
    }, 'fault-reports');

    return apiResponse.success(res, updated!, 'Fault report updated');
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to update fault report');
  }
}
