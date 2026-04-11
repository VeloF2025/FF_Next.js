/**
 * GET /api/tracker/export/pon/[projectId]
 * Styled ExcelJS export for PON Tracker
 */
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const db = neon(process.env.DATABASE_URL!);

const COLS = [
  { key: 'zone_no',                label: 'Zone No',         width: 10 },
  { key: 'hld_pon',                label: 'HLD PON',         width: 12 },
  { key: 'z_pon',                  label: 'Z-PON',           width: 10 },
  { key: 'olt_port',               label: 'OLT Port',        width: 14 },
  { key: 'scope_poles',            label: 'Scope Poles',     width: 13 },
  { key: 'scope_drops',            label: 'Scope Drops',     width: 13 },
  { key: 'pole_permission',        label: 'Pole Permission', width: 18 },
  { key: 'poles_planted',          label: 'Poles Planted',   width: 15 },
  { key: 'cwc_poles_date',         label: 'CWC Poles',       width: 14 },
  { key: 'cwc_stringing_date',     label: 'CWC Stringing',   width: 16 },
  { key: 'ready_for_optical',      label: 'Ready Optical',   width: 16 },
  { key: 'cwc_qa',                 label: 'CWC QA',          width: 10 },
  { key: 'optical_splicing_date',  label: 'Opt. Splicing',   width: 16 },
  { key: 'optical_submitted_date', label: 'Opt. Submitted',  width: 18 },
  { key: 'optical_activated_date', label: 'ATP',             width: 14 },
  { key: 'atp_qa',                 label: 'ATP QA',          width: 10 },
  { key: 'sign_ups',               label: 'Sign-ups',        width: 12 },
  { key: 'homes_po',               label: 'Homes PO',        width: 12 },
  { key: 'homes_recon',            label: 'Homes Recon',     width: 14 },
  { key: 'activated',              label: 'Activated',       width: 12 },
  { key: 'available',              label: 'Available',       width: 12 },
  { key: 'blockage',               label: 'Blockage',        width: 30 },
];

interface RouteParams { params: { projectId: string } }

export async function GET(_req: Request, { params }: RouteParams) {
  const { projectId } = params;
  try {
    const rows = await db.query(
      `SELECT zone_no, hld_pon, z_pon, olt_port, scope_poles, scope_drops,
         TO_CHAR(pole_permission,'YYYY-MM-DD') AS pole_permission, poles_planted,
         TO_CHAR(cwc_poles_date,'YYYY-MM-DD') AS cwc_poles_date,
         TO_CHAR(cwc_stringing_date,'YYYY-MM-DD') AS cwc_stringing_date,
         TO_CHAR(ready_for_optical,'YYYY-MM-DD') AS ready_for_optical,
         cwc_qa,
         TO_CHAR(optical_splicing_date,'YYYY-MM-DD') AS optical_splicing_date,
         TO_CHAR(optical_submitted_date,'YYYY-MM-DD') AS optical_submitted_date,
         TO_CHAR(optical_activated_date,'YYYY-MM-DD') AS optical_activated_date,
         atp_qa, sign_ups, homes_po, homes_recon, activated, available, blockage
       FROM pon_tracker WHERE project_id = $1 ORDER BY zone_no, hld_pon`,
      [projectId]
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    const ws = wb.addWorksheet('PON Tracker');

    // Header row — blue background, white bold text
    ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    // Data rows
    for (const row of rows as Record<string, unknown>[]) {
      const dataRow = ws.addRow(COLS.map((c) => {
        const v = row[c.key];
        if (v === true) return 'Yes';
        if (v === false) return 'No';
        return v ?? '';
      }));
      dataRow.alignment = { vertical: 'middle' };
    }

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Alternating row colours
    for (let i = 2; i <= (rows as unknown[]).length + 1; i++) {
      if (i % 2 === 0) {
        ws.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as unknown as Buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="pon-tracker-${projectId}.xlsx"`,
      },
    });
  } catch (err) {
    log.error('PON export failed', { err, projectId }, 'api/tracker/export');
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
