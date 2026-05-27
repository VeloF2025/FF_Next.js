/**
 * CSV parser for the HR payslip import.
 *
 * Expected columns (header-driven, case-insensitive, order-agnostic):
 *
 *   email             — staff identifier (LOWER()-matched against staff.email)
 *   first_name        — informational, used to confirm match in preview
 *   last_name         — informational
 *   pay_period_start  — YYYY-MM-DD
 *   pay_period_end    — YYYY-MM-DD
 *   gross             — Rand decimal (e.g. "12345.67"); blanks treated as 0
 *   deductions        — Rand decimal
 *   net               — Rand decimal
 *
 * Anything else in the CSV is captured verbatim into `extras` and persisted
 * as raw_data on the payslip row so the staff-side detail view can show
 * line items (medical aid, UIF, PAYE, leave accruals) without re-parsing.
 *
 * Implemented without an external CSV library — the format is small and
 * fully controlled by HR (one row per staff per month, no embedded
 * newlines). A handwritten parser keeps the bundle slim and avoids a
 * supply-chain dependency on a single-use route.
 */

const REQUIRED_COLUMNS = [
  'email',
  'pay_period_start',
  'pay_period_end',
  'gross',
  'deductions',
  'net',
] as const;

export interface ParsedPayslipRow {
  /** Original CSV row index (0-based, excluding header) — for error reporting. */
  rowIndex: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  /** Anything not in the canonical column set — captured for raw_data. */
  extras: Record<string, string>;
}

export interface ParseError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedPayslipRow[];
  errors: ParseError[];
}

/**
 * Parse a CSV body into typed payslip rows. Errors are collected
 * per-row so the import preview can surface them all at once
 * (HR shouldn't have to re-upload after each individual fix).
 */
export function parsePayslipCsv(body: string): ParseResult {
  const errors: ParseError[] = [];
  const rows: ParsedPayslipRow[] = [];

  const lines = splitLines(body);
  if (lines.length === 0) {
    return { rows, errors: [{ rowIndex: 0, field: '_file', message: 'CSV is empty' }] };
  }

  const header = parseLine(lines[0] ?? '').map((h) => h.toLowerCase().trim());
  const headerMap: Record<string, number> = {};
  header.forEach((col, idx) => {
    if (col) headerMap[col] = idx;
  });

  const missing = REQUIRED_COLUMNS.filter((col) => !(col in headerMap));
  if (missing.length > 0) {
    errors.push({
      rowIndex: 0,
      field: '_header',
      message: `Missing required column(s): ${missing.join(', ')}`,
    });
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === '') continue;
    const cells = parseLine(raw);
    const rowIndex = i - 1;

    const email = (cells[headerMap.email!] ?? '').trim().toLowerCase();
    const startRaw = (cells[headerMap.pay_period_start!] ?? '').trim();
    const endRaw = (cells[headerMap.pay_period_end!] ?? '').trim();
    const grossRaw = (cells[headerMap.gross!] ?? '').trim();
    const deductionsRaw = (cells[headerMap.deductions!] ?? '').trim();
    const netRaw = (cells[headerMap.net!] ?? '').trim();

    const rowErrors: ParseError[] = [];

    if (!isEmail(email)) {
      rowErrors.push({ rowIndex, field: 'email', message: `Invalid email: "${email}"` });
    }
    if (!isIsoDate(startRaw)) {
      rowErrors.push({
        rowIndex,
        field: 'pay_period_start',
        message: `Expected YYYY-MM-DD, got "${startRaw}"`,
      });
    }
    if (!isIsoDate(endRaw)) {
      rowErrors.push({
        rowIndex,
        field: 'pay_period_end',
        message: `Expected YYYY-MM-DD, got "${endRaw}"`,
      });
    }
    if (isIsoDate(startRaw) && isIsoDate(endRaw) && endRaw < startRaw) {
      rowErrors.push({
        rowIndex,
        field: 'pay_period_end',
        message: 'pay_period_end is before pay_period_start',
      });
    }

    const gross = parseRand(grossRaw);
    const deductions = parseRand(deductionsRaw);
    const net = parseRand(netRaw);

    if (gross === null) {
      rowErrors.push({ rowIndex, field: 'gross', message: `Not a number: "${grossRaw}"` });
    }
    if (deductions === null) {
      rowErrors.push({
        rowIndex,
        field: 'deductions',
        message: `Not a number: "${deductionsRaw}"`,
      });
    }
    if (net === null) {
      rowErrors.push({ rowIndex, field: 'net', message: `Not a number: "${netRaw}"` });
    }
    if (gross !== null && deductions !== null && net !== null) {
      const expected = gross - deductions;
      if (Math.abs(net - expected) > 1) {
        rowErrors.push({
          rowIndex,
          field: 'net',
          message: `net (${(net / 100).toFixed(2)}) doesn't match gross - deductions (${(expected / 100).toFixed(2)})`,
        });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const extras: Record<string, string> = {};
    for (const [colName, idx] of Object.entries(headerMap)) {
      if ((REQUIRED_COLUMNS as readonly string[]).includes(colName)) continue;
      if (colName === 'first_name' || colName === 'last_name') continue;
      const value = (cells[idx] ?? '').trim();
      if (value !== '') extras[colName] = value;
    }

    rows.push({
      rowIndex,
      email,
      firstName: headerMap.first_name !== undefined
        ? ((cells[headerMap.first_name] ?? '').trim() || null)
        : null,
      lastName: headerMap.last_name !== undefined
        ? ((cells[headerMap.last_name] ?? '').trim() || null)
        : null,
      payPeriodStart: startRaw,
      payPeriodEnd: endRaw,
      grossCents: gross!,
      deductionsCents: deductions!,
      netCents: net!,
      extras,
    });
  }

  return { rows, errors };
}

function splitLines(body: string): string[] {
  // Handle CRLF + LF + CR. Strip BOM (U+FEFF) if present — Excel exports
  // sometimes include it and we don't want it bleeding into the email column.
  const cleaned = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  return cleaned.split(/\r\n|\n|\r/);
}

/**
 * Parse a single CSV line, honouring double-quoted fields with embedded
 * commas and escaped quotes (RFC 4180 minimal subset).
 */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  out.push(cell);
  return out;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Parse "12345.67" or "12,345.67" or "R12 345,67" → 1234567 (cents). Returns null on garbage. */
function parseRand(raw: string): number | null {
  if (raw === '') return 0;
  // Strip currency symbol, whitespace, thousands separators (both . and ,).
  // Accept either '.' or ',' as the decimal mark, prefer the last one in
  // the string as decimal — matches both en-ZA "12 345,67" and "12,345.67".
  const cleaned = raw.replace(/[Rr\s]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIdx = Math.max(lastComma, lastDot);
  let normalised: string;
  if (decimalIdx === -1) {
    normalised = cleaned;
  } else {
    const intPart = cleaned.slice(0, decimalIdx).replace(/[.,]/g, '');
    const fracPart = cleaned.slice(decimalIdx + 1);
    normalised = `${intPart}.${fracPart}`;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
  const rand = Number(normalised);
  if (!Number.isFinite(rand)) return null;
  return Math.round(rand * 100);
}
