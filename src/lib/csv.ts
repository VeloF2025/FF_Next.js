/**
 * Shared CSV utility for server-side CSV export endpoints.
 * Centralises escaping, building, and sending CSV responses.
 */
import type { NextApiResponse } from 'next';

/** UTF-8 BOM for Excel compatibility with ZAR currency symbols */
const BOM = '\uFEFF';

/** Escape a value for CSV embedding (quote-wrapping, double-quote escaping) */
export function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/** Column definition for typed CSV building */
export interface CSVColumn {
  key: string;
  label: string;
}

/**
 * Build CSV string from typed column definitions + row data.
 * Optionally appends a totals row at the bottom.
 */
export function buildCSV(
  columns: CSVColumn[],
  rows: Record<string, unknown>[],
  options?: { totalsRow?: Record<string, unknown> }
): string {
  const header = columns.map((c) => escapeCSV(c.label)).join(',');

  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCSV(row[c.key])).join(',')
  );

  const lines = [header, ...dataLines];

  if (options?.totalsRow) {
    lines.push(
      columns.map((c) => escapeCSV(options.totalsRow![c.key])).join(',')
    );
  }

  return BOM + lines.join('\n');
}

/** Set Content-Type/Disposition headers and send CSV response */
export function sendCSV(res: NextApiResponse, csv: string, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
