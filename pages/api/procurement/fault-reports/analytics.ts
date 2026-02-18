import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { FaultAnalytics, FaultTypeValue } from '@/types/procurement/fault.types';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { project_id } = req.query;

    // Faults by type
    let faultsByTypeRows: Record<string, unknown>[];
    if (project_id) {
      faultsByTypeRows = await sql`
        SELECT fault_type, COUNT(*)::int AS count
        FROM fault_reports
        WHERE project_id = ${project_id as string}::uuid
        GROUP BY fault_type
      `;
    } else {
      faultsByTypeRows = await sql`
        SELECT fault_type, COUNT(*)::int AS count
        FROM fault_reports
        GROUP BY fault_type
      `;
    }

    const faultsByType: Record<FaultTypeValue, number> = {
      dead_on_arrival: 0,
      field_failure: 0,
      physical_damage: 0,
      configuration_error: 0,
      unknown: 0,
    };
    for (const r of faultsByTypeRows) {
      const key = r.fault_type as FaultTypeValue;
      if (key in faultsByType) {
        faultsByType[key] = Number(r.count);
      }
    }

    // Faults by supplier
    let faultsBySupplierRows: Record<string, unknown>[];
    if (project_id) {
      faultsBySupplierRows = await sql`
        SELECT fr.supplier_id, COALESCE(s.company_name, s.name) AS supplier_name, COUNT(*)::int AS count
        FROM fault_reports fr
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        WHERE fr.supplier_id IS NOT NULL AND fr.project_id = ${project_id as string}::uuid
        GROUP BY fr.supplier_id, s.company_name, s.name
        ORDER BY count DESC
        LIMIT 20
      `;
    } else {
      faultsBySupplierRows = await sql`
        SELECT fr.supplier_id, COALESCE(s.company_name, s.name) AS supplier_name, COUNT(*)::int AS count
        FROM fault_reports fr
        LEFT JOIN suppliers s ON fr.supplier_id = s.id
        WHERE fr.supplier_id IS NOT NULL
        GROUP BY fr.supplier_id, s.company_name, s.name
        ORDER BY count DESC
        LIMIT 20
      `;
    }

    const faultsBySupplier = faultsBySupplierRows.map((r) => ({
      supplierId: r.supplier_id as string,
      supplierName: (r.supplier_name ?? 'Unknown') as string,
      count: Number(r.count),
    }));

    // Faults by technician (reported_by)
    let faultsByTechRows: Record<string, unknown>[];
    if (project_id) {
      faultsByTechRows = await sql`
        SELECT reported_by, reported_by_name, COUNT(*)::int AS count
        FROM fault_reports
        WHERE reported_by IS NOT NULL AND project_id = ${project_id as string}::uuid
        GROUP BY reported_by, reported_by_name
        ORDER BY count DESC
        LIMIT 20
      `;
    } else {
      faultsByTechRows = await sql`
        SELECT reported_by, reported_by_name, COUNT(*)::int AS count
        FROM fault_reports
        WHERE reported_by IS NOT NULL
        GROUP BY reported_by, reported_by_name
        ORDER BY count DESC
        LIMIT 20
      `;
    }

    const faultsByTechnician = faultsByTechRows.map((r) => ({
      userId: r.reported_by as string,
      userName: (r.reported_by_name ?? 'Unknown') as string,
      count: Number(r.count),
    }));

    // Faults by project
    const faultsByProjectRows = await sql`
      SELECT fr.project_id, p.project_name, COUNT(*)::int AS count
      FROM fault_reports fr
      LEFT JOIN projects p ON fr.project_id = p.id
      WHERE fr.project_id IS NOT NULL
      GROUP BY fr.project_id, p.project_name
      ORDER BY count DESC
      LIMIT 20
    `;

    const faultsByProject = faultsByProjectRows.map((r) => ({
      projectId: r.project_id as string,
      projectName: (r.project_name ?? 'Unknown') as string,
      count: Number(r.count),
    }));

    // Totals (open vs resolved) and warranty claims
    let statusRows: Record<string, unknown>[];
    if (project_id) {
      statusRows = await sql`
        SELECT
          SUM(CASE WHEN resolution_status NOT IN ('resolved','scrapped') THEN 1 ELSE 0 END)::int AS total_open,
          SUM(CASE WHEN resolution_status IN ('resolved','scrapped') THEN 1 ELSE 0 END)::int AS total_resolved,
          SUM(CASE WHEN resolution_status = 'warranty_claim' THEN 1 ELSE 0 END)::int AS total_warranty
        FROM fault_reports
        WHERE project_id = ${project_id as string}::uuid
      `;
    } else {
      statusRows = await sql`
        SELECT
          SUM(CASE WHEN resolution_status NOT IN ('resolved','scrapped') THEN 1 ELSE 0 END)::int AS total_open,
          SUM(CASE WHEN resolution_status IN ('resolved','scrapped') THEN 1 ELSE 0 END)::int AS total_resolved,
          SUM(CASE WHEN resolution_status = 'warranty_claim' THEN 1 ELSE 0 END)::int AS total_warranty
        FROM fault_reports
      `;
    }

    const s = statusRows[0] ?? {};

    const analytics: FaultAnalytics = {
      faultsByType,
      faultsBySupplier,
      faultsByTechnician,
      faultsByProject,
      mtbf: null, // MTBF requires time-series data on serial history; null until sufficient data
      totalOpen: Number(s.total_open ?? 0),
      totalResolved: Number(s.total_resolved ?? 0),
      totalWarrantyClaims: Number(s.total_warranty ?? 0),
    };

    return apiResponse.success(res, analytics);
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to fetch fault analytics');
  }
}));
