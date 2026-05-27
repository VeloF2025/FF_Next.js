/**
 * PP Sheets — ONT_LIFECYCLE_V2
 *
 * Builds the two PP tabs used when ONT_LIFECYCLE_V2 is enabled:
 *  - "PP — Not Found"             (truly unlinked serials, no DR from any source)
 *  - "PP — Linked, Awaiting Activation" (DR-linked but no OLT-Active confirmation)
 *
 * Style rules mirror the existing PP's tab and ftDisputeSheet.ts:
 *  - Dark header fill (FF1F2937), white bold text
 *  - Thin dark-grey bottom border on header cells
 *  - yyyy/mm/dd for date columns
 *  - Numeric counts as real numbers in the total row
 *  - Freeze row 1 (caller applies views)
 *  - No merged cells, no auto-filters
 */

import ExcelJS from 'exceljs';
import type { NotFoundRow, LinkedAwaitingRow } from './queriesV2';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};

// Highlight for rows that are activated but still on Fibertime's PP list —
// light amber so they stand out against the plain awaiting rows.
const ACTIVATED_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' },
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

/**
 * Adds the "PP — Not Found" sheet to the workbook.
 * These are serials Fibertime lists on PP DATA for which FibreFlow has
 * no DR record from any source (OES, unified reviews, or 1Map).
 * Recovery priority — each row represents an unlocated ONT.
 */
export function addPpNotFoundSheet(
  wb: ExcelJS.Workbook,
  rows: NotFoundRow[],
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('PP — Not Found');

  sheet.columns = [
    { key: 'project',         width: 16 },
    { key: 'serial_number',   width: 20 },
    { key: 'date_registered', width: 18 },
  ];

  styleHeader(sheet.addRow(['Project', 'Serial Number', 'Date Registered']));

  for (const r of rows) {
    sheet.addRow([r.project, r.serial_number, r.date_registered]);
  }

  const totalRow = sheet.addRow([`${rows.length} not found`, '', '']);
  totalRow.font = { bold: true };

  return sheet;
}

/**
 * Adds the "PP — Linked, Awaiting Activation" sheet to the workbook.
 * These serials have a known DR (from OES, unified reviews, or 1Map)
 * but the OLT-Active signal has not yet been recorded in oes_pp_data.activated_at.
 * The `linked_via` array shows which source(s) provided the DR link.
 */
export function addPpLinkedAwaitingSheet(
  wb: ExcelJS.Workbook,
  rows: LinkedAwaitingRow[],
  activatedRows: LinkedAwaitingRow[] = [],
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('PP — Linked');

  sheet.columns = [
    { key: 'project',              width: 16 },
    { key: 'serial_number',        width: 20 },
    { key: 'date_registered',      width: 18 },
    { key: 'resolution_status',    width: 20 },
    { key: 'resolved_drop_number', width: 16 },
    { key: 'resolved_source',      width: 22 },
    { key: 'linked_via',           width: 30 },
  ];

  styleHeader(sheet.addRow([
    'Project', 'Serial Number', 'Date Registered',
    'Resolution Status', 'Matched Drop', 'Source', 'Linked Via',
  ]));

  const addDataRow = (r: LinkedAwaitingRow): ExcelJS.Row =>
    sheet.addRow([
      r.project,
      r.serial_number,
      r.date_registered,
      r.resolution_status,
      r.resolved_drop_number,
      r.resolved_source,
      // linked_via is a TEXT[] from PostgreSQL; join as comma-separated string
      Array.isArray(r.linked_via) ? r.linked_via.join(', ') : '',
    ]);

  for (const r of rows) {
    addDataRow(r);
  }

  // Activated-but-still-on-PP rows, highlighted amber so they're easy to spot.
  for (const r of activatedRows) {
    const row = addDataRow(r);
    row.eachCell((cell: ExcelJS.Cell) => { cell.fill = ACTIVATED_FILL; });
  }

  const summary = activatedRows.length > 0
    ? `${rows.length} awaiting activation + ${activatedRows.length} activated (still on PP list)`
    : `${rows.length} awaiting activation`;
  const totalRow = sheet.addRow([summary, '', '', '', '', '', '']);
  totalRow.font = { bold: true };

  return sheet;
}
