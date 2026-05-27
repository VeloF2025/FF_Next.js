/**
 * FT Dispute Sheets — ONT_LIFECYCLE_V2
 *
 * Builds the two FT Dispute tabs used when ONT_LIFECYCLE_V2 is enabled:
 *  - "FT Dispute — Definite"   (OLT-Active AND on PP — strict physical-source truth)
 *  - "FT Dispute — Lifecycle"  (ever activated, no decommission, on PP — broader set)
 *
 * The two tabs are DISJOINT by construction (see queriesV2.ts): the Lifecycle
 * query explicitly excludes serials in the Definite set.
 *
 * Style rules mirror ftDisputeSheet.ts: DISPUTE_FILL background on data rows,
 * OES_STATUS_FILLS on the status cell, dark header, bold total row.
 */

import ExcelJS from 'exceljs';
import type { FtDisputeDefiniteRow, FtDisputeLifecycleRow } from './queriesV2';
import type { TicketMap, TicketRow } from './queries';

const TICKET_BASE_URL = 'https://app.fibreflow.app/noc/tickets/';

const OES_STATUS_FILLS: Record<string, Partial<ExcelJS.Fill>> = {
  active:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } },
  inactive:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B7280' } },
  offline:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } },
  provisioned: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};

const DISPUTE_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' },
};

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF374151' } } };
  });
  row.height = 18;
}

function addTicketCells(
  row: ExcelJS.Row,
  startCol: number,
  drNumber: string | null | undefined,
  ontSerial: string | null | undefined,
  ticketMap: TicketMap,
): void {
  const keys: string[] = [];
  if (drNumber) keys.push(drNumber.toUpperCase());
  if (ontSerial) keys.push(ontSerial.toUpperCase());

  const seen = new Set<string>();
  const tickets: TicketRow[] = [];
  for (const key of keys) {
    for (const t of ticketMap.get(key) ?? []) {
      if (!seen.has(t.id)) { seen.add(t.id); tickets.push(t); }
    }
  }
  tickets.forEach((ticket, i) => {
    const cell = row.getCell(startCol + i);
    cell.value = { text: ticket.ticket_uid, hyperlink: `${TICKET_BASE_URL}${ticket.id}` };
    cell.font = { color: { argb: 'FF2563EB' }, underline: true };
  });
}

/**
 * Adds the "FT Dispute — Definite" sheet: PP serials whose LATEST activation
 * event in oes_activations shows status='Active'. This is the strict count —
 * the number that should match the physical-source-truth audit.
 */
export function addFtDisputeDefiniteSheet(
  wb: ExcelJS.Workbook,
  rows: FtDisputeDefiniteRow[],
  ticketMap: TicketMap,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('FT Dispute — Definite');

  let maxTicketCols = 0;
  for (const r of rows) {
    const count = [r.drop_number?.toUpperCase(), r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketCols) maxTicketCols = count;
  }

  sheet.columns = [
    { key: 'serial_number',    width: 20 },
    { key: 'project',          width: 18 },
    { key: 'date_registered',  width: 20 },
    { key: 'drop_number',      width: 14 },
    { key: 'activation_date',  width: 18 },
    { key: 'team',             width: 10 },
    { key: 'status',           width: 14 },
    ...Array.from({ length: maxTicketCols }, () => ({ width: 20 })),
  ];

  const headers = [
    'Serial Number', 'Project', 'PP Date Registered',
    'Drop Number', 'Activation Date', 'Team', 'OES Status',
  ];
  styleHeader(sheet.addRow(
    maxTicketCols > 0
      ? [...headers, ...Array.from({ length: maxTicketCols }, (_, i) => `Ticket ${i + 1}`)]
      : headers,
  ));

  for (const r of rows) {
    const row = sheet.addRow([
      r.serial_number, r.project, r.date_registered,
      r.drop_number, r.activation_date, r.team, r.activation_status,
    ]);
    row.eachCell((cell: ExcelJS.Cell) => { cell.fill = DISPUTE_FILL; });
    const fill = OES_STATUS_FILLS[(r.activation_status ?? '').toLowerCase()];
    if (fill) {
      row.getCell(7).fill = fill as ExcelJS.Fill;
      row.getCell(7).font = { color: { argb: 'FFFFFFFF' } };
    }
    addTicketCells(row, 8, r.drop_number, r.serial_number, ticketMap);
  }

  const totalRow = sheet.addRow([`${rows.length} definite disputes`, '', '', '', '', '', '']);
  totalRow.font = { bold: true, color: { argb: 'FFDC2626' } };

  return sheet;
}

/**
 * Adds the "FT Dispute — Lifecycle" sheet: PP serials that have ever been
 * activated (activated_at IS NOT NULL, decommissioned_at IS NULL) but are NOT
 * in the Definite set. These are serials that went offline / got swapped but
 * were never formally decommissioned in FibreFlow.
 */
export function addFtDisputeLifecycleSheet(
  wb: ExcelJS.Workbook,
  rows: FtDisputeLifecycleRow[],
  ticketMap: TicketMap,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('FT Dispute — Lifecycle');

  let maxTicketCols = 0;
  for (const r of rows) {
    const count = [r.drop_number?.toUpperCase(), r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketCols) maxTicketCols = count;
  }

  sheet.columns = [
    { key: 'serial_number',   width: 20 },
    { key: 'project',         width: 18 },
    { key: 'date_registered', width: 20 },
    { key: 'drop_number',     width: 14 },
    { key: 'activated_at',    width: 22 },
    { key: 'resolved_source', width: 22 },
    ...Array.from({ length: maxTicketCols }, () => ({ width: 20 })),
  ];

  const headers = [
    'Serial Number', 'Project', 'PP Date Registered',
    'Drop Number', 'Activated At', 'Source',
  ];
  styleHeader(sheet.addRow(
    maxTicketCols > 0
      ? [...headers, ...Array.from({ length: maxTicketCols }, (_, i) => `Ticket ${i + 1}`)]
      : headers,
  ));

  for (const r of rows) {
    const row = sheet.addRow([
      r.serial_number, r.project, r.date_registered,
      r.drop_number, r.activated_at, r.resolved_source,
    ]);
    row.eachCell((cell: ExcelJS.Cell) => { cell.fill = DISPUTE_FILL; });
    addTicketCells(row, 7, r.drop_number, r.serial_number, ticketMap);
  }

  const totalRow = sheet.addRow([`${rows.length} lifecycle disputes`, '', '', '', '', '']);
  totalRow.font = { bold: true, color: { argb: 'FFDC2626' } };

  return sheet;
}
