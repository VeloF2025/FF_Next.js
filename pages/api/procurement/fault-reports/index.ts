import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import type { FaultReportListItem, FaultTypeValue, FaultSeverityValue, FaultResolutionStatusValue } from '@/types/procurement/fault.types';

const sql = neon(process.env.DATABASE_URL!);

const VALID_FAULT_TYPES: FaultTypeValue[] = [
  'dead_on_arrival', 'field_failure', 'physical_damage', 'configuration_error', 'unknown',
];
const VALID_SEVERITIES: FaultSeverityValue[] = ['minor', 'major', 'critical'];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  const user = (req as AuthenticatedNextApiRequest).user;

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res, user.id, user.firstName ?? 'System');
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}));

// ============= GET — List fault reports =============

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = '1', limit = '50', fault_type, severity, resolution_status, project_id } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    let rows: Record<string, unknown>[];
    let countRows: Record<string, unknown>[];

    // Explicit query branches — no conditional SQL fragments
    if (project_id && fault_type) {
      rows = await sql`
        SELECT fr.*,
               si.item_code, si.description AS item_name,
               ss.serial_number,
               COALESCE(s.company_name, s.name) AS supplier_name
        FROM fault_reports fr
        LEFT JOIN stock_items si ON fr.stock_item_id = si.id
        LEFT JOIN stock_serials ss ON fr.serial_id = ss.id
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        WHERE fr.project_id = ${project_id as string}::uuid
          AND fr.fault_type = ${fault_type as string}
        ORDER BY fr.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      countRows = await sql`
        SELECT COUNT(*)::int AS total FROM fault_reports
        WHERE project_id = ${project_id as string}::uuid AND fault_type = ${fault_type as string}
      `;
    } else if (project_id) {
      rows = await sql`
        SELECT fr.*,
               si.item_code, si.description AS item_name,
               ss.serial_number,
               COALESCE(s.company_name, s.name) AS supplier_name
        FROM fault_reports fr
        LEFT JOIN stock_items si ON fr.stock_item_id = si.id
        LEFT JOIN stock_serials ss ON fr.serial_id = ss.id
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        WHERE fr.project_id = ${project_id as string}::uuid
        ORDER BY fr.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      countRows = await sql`
        SELECT COUNT(*)::int AS total FROM fault_reports
        WHERE project_id = ${project_id as string}::uuid
      `;
    } else if (resolution_status) {
      rows = await sql`
        SELECT fr.*,
               si.item_code, si.description AS item_name,
               ss.serial_number,
               COALESCE(s.company_name, s.name) AS supplier_name
        FROM fault_reports fr
        LEFT JOIN stock_items si ON fr.stock_item_id = si.id
        LEFT JOIN stock_serials ss ON fr.serial_id = ss.id
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        WHERE fr.resolution_status = ${resolution_status as string}
        ORDER BY fr.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      countRows = await sql`
        SELECT COUNT(*)::int AS total FROM fault_reports
        WHERE resolution_status = ${resolution_status as string}
      `;
    } else {
      rows = await sql`
        SELECT fr.*,
               si.item_code, si.description AS item_name,
               ss.serial_number,
               COALESCE(s.company_name, s.name) AS supplier_name
        FROM fault_reports fr
        LEFT JOIN stock_items si ON fr.stock_item_id = si.id
        LEFT JOIN stock_serials ss ON fr.serial_id = ss.id
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        ORDER BY fr.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;
      countRows = await sql`
        SELECT COUNT(*)::int AS total FROM fault_reports
      `;
    }

    const items: FaultReportListItem[] = rows.map((r) => ({
      id: r.id as string,
      projectId: (r.project_id ?? '') as string,
      itemCode: r.item_code as string | undefined,
      itemName: r.item_name as string | undefined,
      serialNumber: r.serial_number as string | undefined,
      faultType: r.fault_type as FaultTypeValue,
      severity: r.severity as FaultSeverityValue,
      resolutionStatus: r.resolution_status as FaultResolutionStatusValue,
      description: r.description as string,
      supplierName: r.supplier_name as string | undefined,
      discoveredByName: r.reported_by_name as string | undefined,
      discoveredAt: new Date(r.reported_at as string),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at as string) : undefined,
      createdAt: new Date(r.created_at as string),
    }));

    return apiResponse.paginated(res, items, {
      page: pageNum,
      pageSize: limitNum,
      total: Number(countRows[0]?.total ?? 0),
    });
  } catch (error) {
    log.error('IndexApi', 'Failed to fetch fault reports', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch fault reports');
  }
}

// ============= POST — Create fault report =============

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string,
  userName: string,
) {
  try {
    const body = req.body;

    // Validate required fields
    if (!body.faultType || !VALID_FAULT_TYPES.includes(body.faultType)) {
      return apiResponse.validationError(res, { faultType: `Must be one of: ${VALID_FAULT_TYPES.join(', ')}` });
    }
    if (!body.severity || !VALID_SEVERITIES.includes(body.severity)) {
      return apiResponse.validationError(res, { severity: `Must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    if (!body.description || typeof body.description !== 'string' || body.description.trim().length === 0) {
      return apiResponse.validationError(res, { description: 'Description is required' });
    }

    // Insert fault report
    const [faultReport] = await sql`
      INSERT INTO fault_reports (
        serial_id,
        stock_item_id,
        fault_type,
        severity,
        description,
        evidence_urls,
        reported_by,
        reported_by_name,
        project_id,
        location_id,
        supplier_id,
        resolution_status
      ) VALUES (
        ${body.serialId ?? null},
        ${body.stockItemId ?? null},
        ${body.faultType},
        ${body.severity},
        ${body.description.trim()},
        ${body.evidenceUrls ?? null},
        ${userId},
        ${userName},
        ${body.projectId ?? null},
        ${body.locationId ?? null},
        ${body.supplierId ?? null},
        'open'
      )
      RETURNING *
    `;

    // If serial_id provided, mark serial as faulty and record fault_report_id
    if (body.serialId) {
      await sql`
        UPDATE stock_serials
        SET previous_status = status,
            status = 'faulty',
            status_changed_at = NOW(),
            status_changed_by = ${userName},
            fault_report_id = ${faultReport!.id}
        WHERE id = ${body.serialId}::uuid
      `;
    }

    // Create audit log entry (fire-and-forget)
    createAuditLog({
      entityType: 'fault_report',
      entityId: faultReport!.id as string,
      action: 'create',
      performedBy: userId,
      performedByName: userName,
      newValues: {
        faultType: body.faultType,
        severity: body.severity,
        serialId: body.serialId,
      },
    });

    log.info('[FaultReports] Created fault report', {
      data: { id: faultReport!.id, faultType: body.faultType, severity: body.severity },
    }, 'fault-reports');

    return apiResponse.created(res, faultReport!, 'Fault report created successfully');
  } catch (error) {
    log.error('IndexApi', 'Failed to create fault report', { error });
    return apiResponse.databaseError(res, error, 'Failed to create fault report');
  }
}
