/**
 * GET /api/pipeline/export
 * Excel export of all pipeline projects with approval statuses pivoted into columns
 */

import type { NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import ExcelJS from 'exceljs';

const sql = neon(process.env.DATABASE_URL!);

// Colors for approval statuses
const STATUS_FILLS: Record<string, Partial<ExcelJS.Fill>> = {
  approved: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } },
  conditionally_approved: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF65A30D' } },
  submitted: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAB308' } },
  in_review: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } },
  preparing: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } },
  not_started: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B7280' } },
  rejected: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } },
  expired: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } },
  not_applicable: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } },
};

const STATUS_FONTS: Record<string, Partial<ExcelJS.Font>> = {
  approved: { color: { argb: 'FFFFFFFF' }, bold: true },
  conditionally_approved: { color: { argb: 'FFFFFFFF' } },
  submitted: { color: { argb: 'FF1F2937' } },
  in_review: { color: { argb: 'FF1F2937' } },
  rejected: { color: { argb: 'FFFFFFFF' }, bold: true },
  expired: { color: { argb: 'FFFFFFFF' } },
  not_started: { color: { argb: 'FFFFFFFF' } },
};

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  qualification: 'Qualification',
  approvals_in_progress: 'Approvals In Progress',
  approvals_complete: 'Approvals Complete',
  po_pending: 'PO Pending',
  ready_to_plan: 'Ready to Plan',
  planned: 'Planned',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
  lost: 'Lost',
};

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Fetch all approval types (for column headers)
    const approvalTypes = await sql`
      SELECT id, name, category
      FROM pipeline_approval_types
      WHERE is_active = true
      ORDER BY
        CASE category WHEN 'wayleave' THEN 1 WHEN 'municipal' THEN 2 WHEN 'environmental' THEN 3 WHEN 'traditional' THEN 4 ELSE 5 END,
        name
    `;

    // 2. Fetch all active pipeline projects with related data
    const projects = await sql`
      SELECT
        pp.*,
        c.company_name as client_name,
        pm.name as pm_name,
        wo.name as wayleaves_officer_name,
        om.name as ops_manager_name
      FROM pipeline_projects pp
      LEFT JOIN clients c ON pp.client_id = c.id
      LEFT JOIN staff pm ON pp.project_manager_id = pm.id
      LEFT JOIN staff wo ON pp.wayleaves_officer_id = wo.id
      LEFT JOIN staff om ON pp.operations_manager_id = om.id
      WHERE pp.is_deleted = false
      ORDER BY pp.pipeline_status, pp.project_name
    `;

    // 3. Fetch all approvals pivoted by project
    const approvals = await sql`
      SELECT
        ppa.pipeline_project_id,
        ppa.approval_type_id,
        ppa.status,
        ppa.approval_date,
        ppa.expiry_date,
        ppa.internal_status
      FROM pipeline_project_approvals ppa
      JOIN pipeline_projects pp ON ppa.pipeline_project_id = pp.id
      WHERE pp.is_deleted = false
    `;

    // Build approval lookup: projectId -> { typeId -> status }
    const approvalMap = new Map<string, Map<string, { status: string; approval_date: string | null; expiry_date: string | null }>>();
    for (const a of approvals) {
      if (!approvalMap.has(a.pipeline_project_id)) {
        approvalMap.set(a.pipeline_project_id, new Map());
      }
      approvalMap.get(a.pipeline_project_id)!.set(a.approval_type_id, {
        status: a.status,
        approval_date: a.approval_date,
        expiry_date: a.expiry_date,
      });
    }

    // 4. Build Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    wb.created = new Date();

    const ws = wb.addWorksheet('Pipeline Projects', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    });

    // --- Define columns ---
    // Group 1: Project Info
    const projectCols: Partial<ExcelJS.Column>[] = [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Project Name', key: 'name', width: 30 },
      { header: 'Province', key: 'province', width: 16 },
      { header: 'Municipality', key: 'municipality', width: 20 },
      { header: 'Area', key: 'area', width: 18 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Rural', key: 'rural', width: 8 },
      { header: 'Status', key: 'pipeline_status', width: 20 },
    ];

    // Group 2: People
    const peopleCols: Partial<ExcelJS.Column>[] = [
      { header: 'Client', key: 'client', width: 20 },
      { header: 'Customer', key: 'customer', width: 15 },
      { header: 'Project Manager', key: 'pm', width: 20 },
      { header: 'Wayleaves Officer', key: 'wo', width: 20 },
      { header: 'Ops Manager', key: 'om', width: 20 },
    ];

    // Group 3: Financials
    const financialCols: Partial<ExcelJS.Column>[] = [
      { header: 'Est. Value', key: 'est_value', width: 14 },
      { header: 'Homes Passed', key: 'homes', width: 14 },
      { header: 'Est. KM', key: 'est_km', width: 10 },
      { header: 'PO Number', key: 'po_number', width: 14 },
      { header: 'PO Value', key: 'po_value', width: 14 },
      { header: 'PO Date', key: 'po_date', width: 12 },
    ];

    // Group 4: Legal
    const legalCols: Partial<ExcelJS.Column>[] = [
      { header: 'Lease Status', key: 'lease', width: 14 },
      { header: 'Cession Status', key: 'cession', width: 14 },
    ];

    // Group 5: Dates
    const dateCols: Partial<ExcelJS.Column>[] = [
      { header: 'Target Start', key: 'target_start', width: 12 },
      { header: 'Target Complete', key: 'target_complete', width: 14 },
      { header: 'Network Method', key: 'network_method', width: 16 },
    ];

    // Group 6: Approval columns (dynamic)
    const approvalCols: Partial<ExcelJS.Column>[] = approvalTypes.map((at: { id: string; name: string }) => ({
      header: at.name,
      key: `approval_${at.id}`,
      width: 16,
    }));

    // Group 7: Summary
    const summaryCols: Partial<ExcelJS.Column>[] = [
      { header: 'Total Approvals', key: 'total_approvals', width: 16 },
      { header: 'Approved', key: 'approved_count', width: 12 },
      { header: '% Complete', key: 'pct_complete', width: 12 },
    ];

    ws.columns = [...projectCols, ...peopleCols, ...financialCols, ...legalCols, ...dateCols, ...approvalCols, ...summaryCols];

    // --- Add category header row (row 1) ---
    const catRow = ws.insertRow(1, []);
    const projectEnd = projectCols.length;
    const peopleEnd = projectEnd + peopleCols.length;
    const financialEnd = peopleEnd + financialCols.length;
    const legalEnd = financialEnd + legalCols.length;
    const dateEnd = legalEnd + dateCols.length;
    const approvalEnd = dateEnd + approvalCols.length;

    const categoryMerges: { start: number; end: number; label: string; color: string }[] = [
      { start: 1, end: projectEnd, label: 'PROJECT INFO', color: 'FF1E40AF' },
      { start: projectEnd + 1, end: peopleEnd, label: 'PEOPLE', color: 'FF7C3AED' },
      { start: peopleEnd + 1, end: financialEnd, label: 'FINANCIALS', color: 'FF047857' },
      { start: financialEnd + 1, end: legalEnd, label: 'LEGAL', color: 'FF92400E' },
      { start: legalEnd + 1, end: dateEnd, label: 'DATES & CONFIG', color: 'FF1F2937' },
      { start: dateEnd + 1, end: approvalEnd, label: 'APPROVALS', color: 'FF991B1B' },
      { start: approvalEnd + 1, end: approvalEnd + summaryCols.length, label: 'SUMMARY', color: 'FF1E3A5F' },
    ];

    for (const cat of categoryMerges) {
      if (cat.end < cat.start) continue;
      ws.mergeCells(1, cat.start, 1, cat.end);
      const cell = catRow.getCell(cat.start);
      cell.value = cat.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cat.color } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    catRow.height = 22;

    // --- Style column header row (row 2) ---
    const headerRow = ws.getRow(2);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 32;

    // --- Add data rows ---
    for (const p of projects) {
      const cf = p.custom_fields || {};
      const projApprovals = approvalMap.get(p.id) || new Map();

      let approvedCount = 0;
      let totalApprovals = 0;
      const approvalValues: Record<string, string> = {};

      for (const at of approvalTypes) {
        const approval = projApprovals.get(at.id);
        if (approval) {
          totalApprovals++;
          if (approval.status === 'approved' || approval.status === 'conditionally_approved') {
            approvedCount++;
          }
          approvalValues[`approval_${at.id}`] = approval.status.replace(/_/g, ' ');
        } else {
          approvalValues[`approval_${at.id}`] = '';
        }
      }

      const row = ws.addRow({
        code: p.project_code,
        name: p.project_name,
        province: p.province,
        municipality: p.municipality,
        area: p.area,
        type: p.project_type,
        priority: p.priority,
        rural: p.is_rural ? 'Yes' : 'No',
        pipeline_status: PIPELINE_STATUS_LABELS[p.pipeline_status] || p.pipeline_status,
        client: p.client_name,
        customer: cf.customer || '',
        pm: p.pm_name,
        wo: p.wayleaves_officer_name,
        om: p.ops_manager_name,
        est_value: p.estimated_value ? Number(p.estimated_value) : null,
        homes: p.estimated_homes_passed ? Number(p.estimated_homes_passed) : null,
        est_km: p.estimated_km ? Number(p.estimated_km) : null,
        po_number: p.po_number,
        po_value: p.po_value ? Number(p.po_value) : null,
        po_date: p.po_date ? new Date(p.po_date) : null,
        lease: p.lease_agreement_status?.replace(/_/g, ' ') || '',
        cession: p.cession_status?.replace(/_/g, ' ') || '',
        target_start: p.target_start_date ? new Date(p.target_start_date) : null,
        target_complete: p.target_completion_date ? new Date(p.target_completion_date) : null,
        network_method: cf.network_method || '',
        ...approvalValues,
        total_approvals: totalApprovals || null,
        approved_count: approvedCount || null,
        pct_complete: totalApprovals > 0 ? Math.round((approvedCount / totalApprovals) * 100) : null,
      });

      // Style approval cells with status colors
      const approvalStartCol = dateEnd + 1;
      for (let i = 0; i < approvalTypes.length; i++) {
        const cell = row.getCell(approvalStartCol + i);
        const status = (cell.value as string || '').replace(/ /g, '_');
        if (STATUS_FILLS[status]) {
          cell.fill = STATUS_FILLS[status] as ExcelJS.Fill;
          cell.font = STATUS_FONTS[status] || { color: { argb: 'FFFFFFFF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      // Format date cells
      if (row.getCell('po_date').value) row.getCell('po_date').numFmt = 'YYYY-MM-DD';
      if (row.getCell('target_start').value) row.getCell('target_start').numFmt = 'YYYY-MM-DD';
      if (row.getCell('target_complete').value) row.getCell('target_complete').numFmt = 'YYYY-MM-DD';

      // Format currency cells
      if (row.getCell('est_value').value) row.getCell('est_value').numFmt = '#,##0';
      if (row.getCell('po_value').value) row.getCell('po_value').numFmt = '#,##0';
      if (row.getCell('pct_complete').value) row.getCell('pct_complete').numFmt = '0"%"';
    }

    // --- Style data rows with alternating colors + borders ---
    const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD1D5DB' } };
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 2) return;
      row.font = row.font || { size: 10 };
      row.fill = row.fill || {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: rowNum % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' },
      };
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === undefined) {
          cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: rowNum % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' },
          };
        }
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      });
    });

    // Also add borders to header rows
    for (let r = 1; r <= 2; r++) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      });
    }

    // --- Auto-filter on header row ---
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: ws.columnCount } };

    // 5. Write and send
    const buffer = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Pipeline-Projects-${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', (buffer as Buffer).length);
    res.status(200).send(buffer);

    log.info('Pipeline export generated', {
      projects: projects.length,
      approvalTypes: approvalTypes.length,
      user: req.user.email,
    }, 'pipeline-export');

  } catch (error) {
    log.error('Pipeline export failed', { error }, 'pipeline-export');
    return res.status(500).json({ error: 'Export failed' });
  }
}

export default withAuth(handler);
