/**
 * GET /api/tracker/export/master/[projectId]
 * Styled ExcelJS export for Master Tracker — colour-coded column groups
 */
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const db = neon(process.env.DATABASE_URL!);

interface ColDef { key: string; label: string; width: number; group: string }

const COLS: ColDef[] = [
  { key:'site',label:'Site',width:12,group:'Identity' },
  { key:'phase',label:'Phase',width:8,group:'Identity' },
  { key:'dr',label:'DR',width:14,group:'Identity' },
  { key:'zone_no',label:'Zone',width:8,group:'Identity' },
  { key:'hld_pon',label:'HLD PON',width:12,group:'Identity' },
  { key:'zone_pon',label:'Zone PON',width:12,group:'Identity' },
  { key:'pole_label',label:'Pole #',width:16,group:'Identity' },
  { key:'unique_pole_label',label:'Unique Pole #',width:18,group:'Identity' },
  { key:'pole_scope',label:'Scope',width:12,group:'Pole Works' },
  { key:'pole_type',label:'Type',width:18,group:'Pole Works' },
  { key:'pole_route_type',label:'Route Type',width:16,group:'Pole Works' },
  { key:'pole_permission_date',label:'Permission',width:14,group:'Pole Works' },
  { key:'pole_install_date',label:'Install Date',width:14,group:'Pole Works' },
  { key:'pole_cwc_date',label:'CWC Date',width:14,group:'Pole Works' },
  { key:'pole_contractor',label:'Contractor',width:16,group:'Pole Works' },
  { key:'pole_rate',label:'Rate',width:12,group:'Pole Works' },
  { key:'pole_paid_date',label:'Paid Date',width:14,group:'Pole Works' },
  { key:'pole_invoice_no',label:'Invoice #',width:14,group:'Pole Works' },
  { key:'pole_comment',label:'Comment',width:22,group:'Pole Works' },
  { key:'civil_description',label:'Description',width:20,group:'Civil' },
  { key:'civil_rate',label:'Rate',width:12,group:'Civil' },
  { key:'civil_qty',label:'Qty',width:8,group:'Civil' },
  { key:'civil_total',label:'Total',width:12,group:'Civil' },
  { key:'civil_invoice_no',label:'Invoice #',width:14,group:'Civil' },
  { key:'civil_invoice_date',label:'Invoice Date',width:14,group:'Civil' },
  { key:'civil_comment',label:'Comment',width:20,group:'Civil' },
  { key:'stringing_description',label:'Description',width:20,group:'Stringing' },
  { key:'stringing_rate',label:'Rate',width:12,group:'Stringing' },
  { key:'stringing_qty',label:'Qty',width:8,group:'Stringing' },
  { key:'stringing_total',label:'Total',width:12,group:'Stringing' },
  { key:'stringing_invoice_no',label:'Invoice #',width:14,group:'Stringing' },
  { key:'stringing_date',label:'Date',width:14,group:'Stringing' },
  { key:'stringing_comment',label:'Comment',width:20,group:'Stringing' },
  { key:'signup_date',label:'Sign-up Date',width:14,group:'Home' },
  { key:'home_install_date',label:'Install Date',width:14,group:'Home' },
  { key:'home_contractor',label:'Contractor',width:16,group:'Home' },
  { key:'home_rate',label:'Rate',width:12,group:'Home' },
  { key:'home_paid_date',label:'Paid Date',width:14,group:'Home' },
  { key:'home_invoice_no',label:'Invoice #',width:14,group:'Home' },
  { key:'activation_code',label:'Code',width:18,group:'Activation' },
  { key:'activation_date',label:'Date',width:14,group:'Activation' },
  { key:'activation_team',label:'Team',width:12,group:'Activation' },
  { key:'activation_rate',label:'Rate',width:12,group:'Activation' },
  { key:'activation_paid_date',label:'Paid Date',width:14,group:'Activation' },
  { key:'activation_invoice_no',label:'Invoice #',width:14,group:'Activation' },
  { key:'remittance',label:'Remittance',width:14,group:'Activation' },
  { key:'remittance_date',label:'Remittance Date',width:16,group:'Activation' },
  { key:'cwc_pole_status',label:'Pole Status',width:14,group:'CWC QA' },
  { key:'cwc_stringing_status',label:'Stringing Status',width:18,group:'CWC QA' },
  { key:'cwc_qa_submit_date',label:'QA Submit',width:14,group:'CWC QA' },
  { key:'cwc_qa_approved_date',label:'QA Approved',width:15,group:'CWC QA' },
  { key:'qa_home_recon_no',label:'Home Recon #',width:16,group:'CWC QA' },
  { key:'exfo_exchange',label:'Exfo Exchange',width:18,group:'Optical' },
  { key:'optical_contractor',label:'Contractor',width:16,group:'Optical' },
  { key:'optical_type',label:'Type',width:12,group:'Optical' },
  { key:'optical_splitter',label:'Splitter',width:12,group:'Optical' },
  { key:'optical_prepping',label:'Prepping',width:14,group:'Optical' },
  { key:'optical_splicing',label:'Splicing',width:14,group:'Optical' },
  { key:'qa_photos_loaded',label:'QA Photos',width:12,group:'Optical' },
  { key:'atp_qa_submit_date',label:'ATP Submit',width:14,group:'Optical' },
  { key:'atp_qa_approved_date',label:'ATP Approved',width:16,group:'Optical' },
  { key:'testing_status',label:'Testing Status',width:16,group:'Optical' },
  { key:'test_submitted',label:'Test Submitted',width:16,group:'Optical' },
  { key:'olt_port_activation',label:'OLT Port',width:18,group:'Optical' },
  { key:'olt_port_activated',label:'OLT Activated',width:16,group:'Optical' },
  { key:'pon_status',label:'PON Status',width:14,group:'Status' },
  { key:'optical_rate',label:'Optical Rate',width:14,group:'Status' },
  { key:'optical_invoice_date',label:'Optical Inv Date',width:18,group:'Status' },
  { key:'optical_invoice_no',label:'Optical Inv #',width:16,group:'Status' },
];

// Group → header background colour (ARGB)
const GROUP_COLORS: Record<string, string> = {
  'Identity':   'FF334155',
  'Pole Works': 'FF1E3A5F',
  'Civil':      'FF3B1F5F',
  'Stringing':  'FF0F4A4A',
  'Home':       'FF14532D',
  'Activation': 'FF713F12',
  'CWC QA':     'FF7C2D12',
  'Optical':    'FF164E63',
  'Status':     'FF4C0519',
};

interface RouteParams { params: { projectId: string } }

export async function GET(_req: Request, { params }: RouteParams) {
  const { projectId } = params;
  try {
    const rows = await db.query(
      `SELECT * FROM master_tracker WHERE project_id = $1 ORDER BY zone_no, hld_pon, zone_pon`,
      [projectId]
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    const ws = wb.addWorksheet('Master Tracker');

    // Row 1: Group headers (merged cells per group)
    const groups: { label: string; startCol: number; endCol: number }[] = [];
    let lastGroup = '';
    COLS.forEach((c, i) => {
      if (c.group !== lastGroup) {
        groups.push({ label: c.group, startCol: i + 1, endCol: i + 1 });
        lastGroup = c.group;
      } else {
        groups[groups.length - 1]!.endCol = i + 1;
      }
    });

    for (const g of groups) {
      const startCell = ws.getCell(1, g.startCol);
      startCell.value = g.label;
      startCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      startCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_COLORS[g.label] ?? 'FF334155' } };
      startCell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (g.endCol > g.startCol) {
        ws.mergeCells(1, g.startCol, 1, g.endCol);
      }
    }
    ws.getRow(1).height = 20;

    // Row 2: Column headers — same group colour, lighter tone
    COLS.forEach((c, i) => {
      const cell = ws.getCell(2, i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_COLORS[c.group] ?? 'FF334155' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF64748B' } } };
    });
    ws.getRow(2).height = 20;

    // Column widths
    ws.columns = COLS.map((c) => ({ width: c.width }));

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

    // Freeze top 2 rows
    ws.views = [{ state: 'frozen', ySplit: 2 }];

    // Alternating row colours (starting row 3)
    for (let i = 3; i <= (rows as unknown[]).length + 2; i++) {
      if (i % 2 !== 0) {
        ws.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="master-tracker-${projectId}.xlsx"`,
      },
    });
  } catch (err) {
    log.error('Master export failed', { err, projectId }, 'api/tracker/export');
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
