/**
 * CSV serialisation for report exports.
 *
 * Two hazards, both of which have bitten spreadsheets everywhere:
 *
 * 1. Quoting. A field containing a comma, a quote or a newline must be quoted and its
 *    quotes doubled (RFC 4180). Action-item descriptions are transcript text and contain
 *    all three routinely, so getting this wrong shifts every subsequent column.
 *
 * 2. Formula injection. Excel, LibreOffice and Sheets evaluate a cell whose text begins
 *    with `=`, `+`, `-` or `@`. A meeting title of `=HYPERLINK("http://x","click")` opens
 *    a live link in the recipient's spreadsheet; `=cmd|...` has historically executed.
 *    This export carries free text written by other people, so the content is not ours to
 *    trust. Neutralised by prefixing an apostrophe, which spreadsheets strip on display
 *    and which round-trips as data.
 */

/** Characters that make a spreadsheet treat the cell as a formula rather than text. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A UTF-8 byte-order mark.
 *
 * Excel on Windows reads a BOM-less UTF-8 CSV as the system codepage, which turns every
 * non-ASCII character in a South African name or address into mojibake. Sheets and
 * LibreOffice ignore it.
 */
export const UTF8_BOM = '﻿';

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  // Neutralise BEFORE quoting: a leading `=` inside quotes is still a formula, because
  // the quotes are CSV syntax and are gone by the time the spreadsheet parses the cell.
  if (FORMULA_LEAD.test(text)) text = `'${text}`;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvColumn<T> {
  /** Header text, written verbatim. */
  header: string;
  value: (row: T) => unknown;
}

/**
 * Serialise rows to CSV text.
 *
 * CRLF line endings, per RFC 4180 — Excel accepts LF but some older importers do not,
 * and a quoted field containing a bare LF is ambiguous to them.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  }
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Quotes and newlines would let a project name break out of the header value and inject
 * another header; path separators would suggest a directory to some clients.
 */
export function safeFilename(stem: string, date: string): string {
  const cleaned = stem.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
  return `${cleaned || 'export'}-${date}.csv`;
}
