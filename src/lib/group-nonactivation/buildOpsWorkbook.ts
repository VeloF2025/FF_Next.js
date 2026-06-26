/**
 * exceljs builder for the consolidated "Unresolved Pre-Provision" worklist.
 * One row per open not_found PP serial, grouped by project, with reconciliation
 * classification, a likely-DR hint, and aging.
 *
 * @module lib/group-nonactivation/buildOpsWorkbook
 */
import ExcelJS from 'exceljs';
import type { OpsRow } from './opsQueries';
import { RESIDUAL_LABEL, type ResidualClass } from './format';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const CLASS_FILL: Record<ResidualClass, string> = {
  resolved: 'FFE2EFDA',
  resolvable: 'FFFFF2CC',
  placeholder: 'FFFCE4D6',
  in_stock_no_install: 'FFDDEBF7',
  unknown: 'FFF2DCDB',
};

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  row.height = 18;
}

function autosize(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col: Partial<ExcelJS.Column>) => {
    let width = 10;
    col.eachCell?.({ includeEmpty: false }, (cell: ExcelJS.Cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len + 2 > width) width = len + 2;
    });
    col.width = Math.min(Math.max(width, 10), 48);
  });
}

export async function buildOpsWorkbook(rows: OpsRow[], asOfDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // Summary tab — counts by class and by project.
  const sum = wb.addWorksheet('Summary');
  sum.addRow(['Unresolved Pre-Provision — reconciliation worklist']);
  sum.getCell('A1').font = { bold: true, size: 14 };
  sum.addRow([`As of: ${asOfDate}   |   Total open not_found serials: ${rows.length}`]);
  sum.addRow([]);
  styleHeaderRow(sum.addRow(['Reconciliation class', 'Count']));
  const byClass = new Map<ResidualClass, number>();
  const byProject = new Map<string, number>();
  for (const r of rows) {
    byClass.set(r.residualClass, (byClass.get(r.residualClass) ?? 0) + 1);
    byProject.set(r.project, (byProject.get(r.project) ?? 0) + 1);
  }
  (['placeholder', 'resolvable', 'in_stock_no_install', 'unknown', 'resolved'] as ResidualClass[])
    .filter((c) => byClass.has(c))
    .forEach((c) => sum.addRow([RESIDUAL_LABEL[c], byClass.get(c) ?? 0]));
  sum.addRow([]);
  styleHeaderRow(sum.addRow(['Project', 'Count']));
  [...byProject.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, n]) => sum.addRow([p, n]));
  autosize(sum);

  // Detail tab — one row per serial.
  const ws = wb.addWorksheet('Unresolved PP');
  styleHeaderRow(ws.addRow(['ONT Serial', 'Project', 'Reconciliation', 'Likely DR', 'Days on PP list', 'Registered']));
  for (const r of rows) {
    const row = ws.addRow([
      r.serial,
      r.project,
      RESIDUAL_LABEL[r.residualClass],
      r.hintDrop ?? '',
      r.agingDays,
      r.dateRegistered,
    ]);
    row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLASS_FILL[r.residualClass] } };
  }
  ws.autoFilter = { from: 'A1', to: 'F1' };
  autosize(ws);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
