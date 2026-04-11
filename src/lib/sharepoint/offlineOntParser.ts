/**
 * Offline ONT Report Parser
 *
 * Parses the "Offline ONTs" sheet from Fibertime SharePoint Offline ONT reports.
 * File format: offline_ont_report_{SITE}_{YYYYMMDD}.xlsx
 * Sheet: "Offline ONTs"
 * Columns: Drop Number, Area, Serial Number, Reason, Last Event Time, ONT Address
 *
 * Pure parsing functions — no DB calls, no side effects.
 */

import * as XLSX from 'xlsx';
import { createLogger } from '@/lib/logger';

const logger = createLogger('sharepoint:offlineOntParser');

// ============================================================================
// TYPES
// ============================================================================

export interface OfflineOntRow {
  drop_number: string;
  area: string;            // 'LAW' | 'MAM' | 'MOA' | 'TEM'
  serial_number: string;
  reason: string;          // 'Device Not Active' | 'Dying Gasp' | 'LOS' | etc.
  last_event_time: string | null;  // ISO timestamp from Excel serial date
  ont_address: string;
  // Parsed from ont_address (e.g. law.olt.01:1-1-3-10-25)
  olt_rack: number | null;
  olt_shelf: number | null;
  olt_slot: number | null;
  olt_port: number | null;
  olt_ont: number | null;
}

export interface OfflineOntParseResult {
  rows: OfflineOntRow[];
  warnings: string[];
  sheetName: string;
}

// ============================================================================
// DATE CONVERSION
// ============================================================================

/**
 * Convert an Excel serial date number to ISO 8601 timestamp string.
 * Uses the same epoch as oesExcelParser.ts (Dec 30 1899).
 * Returns null for falsy or non-numeric input.
 */
function excelDateTimeToISO(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    return null;
  }

  if (typeof value !== 'number' || !isFinite(value)) return null;

  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

// ============================================================================
// OLT ADDRESS PARSING
// ============================================================================

/**
 * Parse OLT address to rack/shelf/slot/port/ont components.
 *
 * Formats observed:
 *   law.olt.01:1-1-3-10-25   → rack=1, shelf=1, slot=3, port=10, ont=25
 *   mam.olt.02:1-2-4-5       → rack=1, shelf=2, slot=4, port=5, ont=null
 *   tem.olt.01:1-1-2-8-3     → rack=1, shelf=1, slot=2, port=8, ont=3
 */
function parseOltAddress(address: string): {
  olt_rack: number | null;
  olt_shelf: number | null;
  olt_slot: number | null;
  olt_port: number | null;
  olt_ont: number | null;
} {
  const empty = { olt_rack: null, olt_shelf: null, olt_slot: null, olt_port: null, olt_ont: null };
  if (!address || typeof address !== 'string') return empty;

  // Match colon-separated suffix: :1-1-3-10-25 (5 parts) or :1-1-3-10 (4 parts)
  const colonIdx = address.indexOf(':');
  if (colonIdx === -1) return empty;

  const parts = address.slice(colonIdx + 1).split('-');
  if (parts.length < 4) return empty;

  const toInt = (s: string | undefined): number | null => {
    if (s === undefined || s === '') return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };

  return {
    olt_rack: toInt(parts[0]),
    olt_shelf: toInt(parts[1]),
    olt_slot: toInt(parts[2]),
    olt_port: toInt(parts[3]),
    olt_ont: parts.length >= 5 ? toInt(parts[4]) : null,
  };
}

// ============================================================================
// ROW NORMALISATION
// ============================================================================

/** Column header names as they appear in the "Offline ONTs" sheet. */
const COL_DROP = 'Drop Number';
const COL_AREA = 'Area';
const COL_SERIAL = 'Serial Number';
const COL_REASON = 'Reason';
const COL_LAST_EVENT = 'Last Event Time';
const COL_ADDRESS = 'ONT Address';

const EXPECTED_HEADERS = [COL_DROP, COL_AREA, COL_SERIAL, COL_REASON, COL_LAST_EVENT, COL_ADDRESS];

interface RawRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function normaliseRow(raw: RawRow): OfflineOntRow | null {
  const dropNumber = String(raw[COL_DROP] ?? '').trim();
  if (!dropNumber.startsWith('DR')) return null;

  const area = String(raw[COL_AREA] ?? '').trim().toUpperCase();
  const serialNumber = String(raw[COL_SERIAL] ?? '').trim();
  const reason = String(raw[COL_REASON] ?? '').trim() || 'Unknown';
  const lastEventTime = excelDateTimeToISO(raw[COL_LAST_EVENT]);
  const ontAddress = String(raw[COL_ADDRESS] ?? '').trim();
  const oltParts = parseOltAddress(ontAddress);

  return {
    drop_number: dropNumber,
    area,
    serial_number: serialNumber,
    reason,
    last_event_time: lastEventTime,
    ont_address: ontAddress,
    ...oltParts,
  };
}

// ============================================================================
// MAIN PARSER
// ============================================================================

/**
 * Parse an Offline ONT report Excel file.
 *
 * @param filePath - Absolute path to the .xlsx file
 * @returns Parsed rows, any warnings, and the detected sheet name
 * @throws Error if the "Offline ONTs" sheet is not found
 */
export function parseOfflineOntExcel(filePath: string): OfflineOntParseResult {
  const workbook = XLSX.readFile(filePath);
  const warnings: string[] = [];

  // Locate the "Offline ONTs" sheet (case-insensitive fallback)
  let sheetName = workbook.SheetNames.find(
    n => n.trim().toLowerCase() === 'offline onts'
  );
  if (!sheetName) {
    sheetName = workbook.SheetNames.find(
      n => n.trim().toLowerCase().includes('offline')
    );
  }
  if (!sheetName) {
    throw new Error(
      `Offline ONT sheet not found. Available sheets: ${workbook.SheetNames.join(', ')}`
    );
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Failed to read sheet "${sheetName}"`);
  }

  // Validate headers
  const rawMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  if (rawMatrix.length === 0) {
    warnings.push('Sheet is empty');
    return { rows: [], warnings, sheetName };
  }

  const headers = (rawMatrix[0] as unknown[]).map(h => String(h ?? '').trim());
  const missingHeaders = EXPECTED_HEADERS.filter(
    exp => !headers.some(h => h.toLowerCase() === exp.toLowerCase())
  );
  if (missingHeaders.length > 0) {
    warnings.push(`Missing expected headers: ${missingHeaders.join(', ')}`);
  }

  // Parse rows
  const data = XLSX.utils.sheet_to_json<RawRow>(sheet);
  const rows: OfflineOntRow[] = [];

  for (const raw of data) {
    const row = normaliseRow(raw);
    if (row === null) continue;
    rows.push(row);
  }

  logger.info('Offline ONT parse complete', {
    sheetName,
    totalDataRows: data.length,
    validRows: rows.length,
    warnings: warnings.length,
  });

  return { rows, warnings, sheetName };
}
