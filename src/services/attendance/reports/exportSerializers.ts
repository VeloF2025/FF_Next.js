import * as XLSX from 'xlsx';

import type { ReportColumn } from './types';

function formatCell(value: unknown, column: ReportColumn): string | number {
  if (value === undefined || value === null) return '';
  if (column.format === 'currency_rand' && typeof value === 'number') return Number(value.toFixed(2));
  if (column.format === 'integer' && typeof value === 'number') return Math.trunc(value);
  if (column.format === 'number' && typeof value === 'number') return Number(value.toFixed(2));
  if (typeof value === 'number') return value;
  return String(value);
}

export function serializeReportCsv(
  rows: Array<Record<string, unknown>>,
  columns: ReadonlyArray<ReportColumn>,
): string {
  const lines = [columns.map((column) => column.label).join(',')];
  for (const row of rows) {
    const cells = columns.map((column) => {
      const formatted = formatCell(row[column.key], column);
      const value = typeof formatted === 'string' && /^[=+\-@]/.test(formatted)
        ? `'${formatted}`
        : String(formatted);
      return /[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    });
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

export function serializeReportXlsx(
  rows: Array<Record<string, unknown>>,
  columns: ReadonlyArray<ReportColumn>,
  sheetName: string,
): Buffer {
  const sheetRows = rows.map((row) => {
    const output: Record<string, string | number> = {};
    for (const column of columns) output[column.label] = formatCell(row[column.key], column);
    return output;
  });
  const worksheet = XLSX.utils.json_to_sheet(sheetRows, {
    header: columns.map((column) => column.label),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
