/**
 * GET /api/tracker/export/pon/[projectId]
 * Styled ExcelJS export for Build Tracker (reads pon_stage_tracking)
 */
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

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
  { key: 'scope_string_m',         label: 'Stringing (m)',   width: 14 },
  { key: 'blockage',               label: 'Blockage',        width: 30 },
];

interface Params { params: Promise<{ projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { projectId } = await params;
  try {
    const { rows } = await pool.query(
      `SELECT
         p.zone_no,
         p.hld_pon,
         p.z_pon,
         p.olt_port,
         p.permissions_approved::text         AS scope_poles,
         NULL::text                           AS scope_drops,
         TO_CHAR(p.permissions_first_date, 'YYYY-MM-DD') AS pole_permission,
         p.poles_planted,
         TO_CHAR(p.cwc_first_date,  'YYYY-MM-DD') AS cwc_poles_date,
         TO_CHAR(p.cwc_last_date,   'YYYY-MM-DD') AS cwc_stringing_date,
         TO_CHAR(p.optical_first_date, 'YYYY-MM-DD') AS ready_for_optical,
         CASE WHEN p.cwc_complete >= p.cwc_total AND p.cwc_total > 0 THEN true ELSE false END AS cwc_qa,
         TO_CHAR(p.optical_first_date,  'YYYY-MM-DD') AS optical_splicing_date,
         TO_CHAR(p.optical_last_date,   'YYYY-MM-DD') AS optical_submitted_date,
         TO_CHAR(p.atp_first_date,      'YYYY-MM-DD') AS optical_activated_date,
         CASE WHEN p.atp_passed >= p.atp_total AND p.atp_total > 0 THEN true ELSE false END AS atp_qa,
         p.sign_ups,
         p.homes_po,
         p.homes_recon,
         p.activation_complete AS activated,
         p.available,
         p.scope_string        AS scope_string_m,
         COALESCE(o.blockage, p.blockage) AS blockage
       FROM pon_stage_tracking p
       LEFT JOIN pon_manual_overrides o ON o.pon_stage_id = p.id
       WHERE p.project_id = $1
       ORDER BY p.zone_no, p.hld_pon`,
      [projectId]
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    const ws = wb.addWorksheet('Build Tracker');

    ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    for (const row of rows as Record<string, unknown>[]) {
      const dataRow = ws.addRow(COLS.map((c) => {
        const v = row[c.key];
        if (v === true) return 'Yes';
        if (v === false) return 'No';
        return v ?? '';
      }));
      dataRow.alignment = { vertical: 'middle' };
    }

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (let i = 2; i <= rows.length + 1; i++) {
      if (i % 2 === 0) {
        ws.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="build-tracker-${projectId}.xlsx"`,
      },
    });
  } catch (err) {
    log.error('PON export failed', { err, projectId }, 'api/tracker/export');
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
