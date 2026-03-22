/**
 * OES Excel Parser
 *
 * Pure Excel parsing functions for Nokia OES activation reports.
 * Handles column mapping, date conversion, header validation, and
 * data sample validation. No side effects — all functions are pure.
 */

import * as XLSX from 'xlsx';
import { createLogger } from '@/lib/logger';

const logger = createLogger('oes/oesExcelParser');

// ============================================================================
// TYPES
// ============================================================================

export interface OESRow {
  drop_number: string;
  serial_number: string;
  activation_date: string;
  activation_datetime: string | null;
  olt_address: string;
  ont_rx_sig_dbm: number | null;
  link_budget_ont_olt_db: number | null;
  olt_rx_sig_dbm: number | null;
  link_budget_olt_ont_db: number | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  current_ont_rx: number | null;
  team: string;
}

export interface PPRow {
  project: string;
  serial_number: string;
  date_registered: string | null;
}

export interface ParseResult {
  rows: OESRow[];
  warnings: string[];
  headerMismatch: boolean;
  ppRows: PPRow[] | null;
}

/** Parse Excel serial date to ISO date string (date only). */
export function excelDateToISO(serial: number): string {
  // Excel's epoch: Dec 30 1899 (Excel incorrectly treats 1900 as a leap year)
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0] as string;
}

/** Parse Excel serial date to full ISO timestamp (fractional part = time of day). */
export function excelDateTimeToISO(serial: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

// Expected headers (Jan 2027 format - 13 columns, Stack Ref removed)
export const EXPECTED_HEADERS = [
  'Drop Number', 'Serial Number', 'Timestamp', 'OLT Address',
  'ONT Rx SIG (dBm)', 'Link Budget ONT->OLT (dB)', 'OLT Rx SIG (dBm)',
  'Link Budget OLT->ONT (dB)', 'Status', 'Latitude', 'Longitude',
  'Current ONT RX', 'Team',
];

/** Validate Excel headers match expected format. */
export function validateHeaders(headers: unknown[]): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (headers.length < 13) {
    warnings.push(`Column count mismatch: expected 13, got ${headers.length}. Format may have changed.`);
  } else if (headers.length > 13) {
    warnings.push(`Extra columns detected: expected 13, got ${headers.length}. New columns may have been added.`);
  }

  // Check key headers are in expected positions (Jan 2027 format - no Stack Ref)
  const headerChecks = [
    { index: 0, expected: 'Drop Number', actual: headers[0] },
    { index: 4, expected: 'ONT Rx SIG (dBm)', actual: headers[4] },
    { index: 8, expected: 'Status', actual: headers[8] },
    { index: 12, expected: 'Team', actual: headers[12] },
  ];

  for (const check of headerChecks) {
    const actualStr = String(check.actual ?? '').trim();
    if (!actualStr.toLowerCase().includes((check.expected.toLowerCase().split(' ')[0] ?? ''))) {
      warnings.push(`Header mismatch at column ${check.index + 1}: expected "${check.expected}", got "${actualStr}"`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/** Validate data values look correct — detect column misalignment. */
export function validateDataSample(rows: OESRow[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, rows.length);

  let statusNumericCount = 0;
  let teamNumericCount = 0;
  let invalidStatusCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i];
    if (!row) continue;

    if (row.status && !isNaN(parseFloat(row.status))) {
      statusNumericCount++;
    }

    if (row.status && !['active', 'inactive', ''].includes(row.status.toLowerCase())) {
      invalidStatusCount++;
    }

    if (row.team && /^-?\d+\.\d+$/.test(row.team)) {
      teamNumericCount++;
    }
  }

  if (statusNumericCount > sampleSize / 2) {
    warnings.push(`Status column contains numeric values (${statusNumericCount}/${sampleSize} rows). Columns may be misaligned!`);
  }

  if (teamNumericCount > sampleSize / 2) {
    warnings.push(`Team column contains coordinate-like values (${teamNumericCount}/${sampleSize} rows). Columns may be misaligned!`);
  }

  if (invalidStatusCount > sampleSize / 2 && statusNumericCount === 0) {
    warnings.push(`Status values unexpected: ${rows.slice(0, 3).map(r => r.status).join(', ')}. Expected "Active" or "Inactive".`);
  }

  return warnings;
}

const PP_PROJECT_CODE_MAP: Record<string, string> = {
  'LAW': 'Lawley',
  'MOA': 'Mohadin',
  'MAM': 'Mamelodi',
};

/** Parse PP DATA sheet from an already-loaded workbook. Returns null if not found. */
export function parsePPDataSheet(workbook: XLSX.WorkBook): PPRow[] | null {
  const ppSheetName = workbook.SheetNames.find(name =>
    name.toUpperCase().includes('PP')
  );

  if (!ppSheetName) return null;

  const sheet = workbook.Sheets[ppSheetName];
  if (!sheet) return null;

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  if (data.length < 2) return null;

  const rows: PPRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0] || !row[1]) continue;

    const rawProject = String(row[0]).trim().toUpperCase();
    const serialNumber = String(row[1]).trim();
    if (!serialNumber) continue;

    let dateRegistered: string | null = null;
    if (row[2] !== undefined && row[2] !== null && row[2] !== '') {
      if (typeof row[2] === 'number') {
        dateRegistered = excelDateToISO(row[2]);
      } else {
        dateRegistered = String(row[2]).trim();
      }
    }

    rows.push({
      project: PP_PROJECT_CODE_MAP[rawProject] || rawProject,
      serial_number: serialNumber,
      date_registered: dateRegistered,
    });
  }

  return rows.length > 0 ? rows : null;
}

/** Parse Excel file — reads first sheet (OLT DATA) and optionally PP DATA. */
export function parseOESExcel(filePath: string): ParseResult {
  const workbook = XLSX.readFile(filePath);

  const ppRows = parsePPDataSheet(workbook);
  if (ppRows) {
    logger.info(`Found PP DATA sheet with ${ppRows.length} rows`);
  }

  const sheetName = workbook.SheetNames[0] as string;
  const sheet = workbook.Sheets[sheetName] ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = XLSX.utils.sheet_to_json(sheet as XLSX.WorkSheet, { header: 1 }) as any[][];

  const warnings: string[] = [];
  let headerMismatch = false;

  if (data.length > 0) {
    const firstRow = data[0] as unknown[];
    const headerValidation = validateHeaders(firstRow);
    if (!headerValidation.valid) {
      headerMismatch = true;
      warnings.push(...headerValidation.warnings);
    }
  }

  const rows: OESRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const dropNumber = String(row[0] ?? '').trim();
    if (!dropNumber.startsWith('DR')) continue;

    // Parse activation date/datetime
    let activationDate: string;
    let activationDatetime: string | null = null;
    if (typeof row[2] === 'number') {
      activationDate = excelDateToISO(row[2]);
      // Fractional part indicates time-of-day information
      if (row[2] % 1 !== 0) {
        activationDatetime = excelDateTimeToISO(row[2]);
      }
    } else {
      activationDate = String(row[2] ?? '');
    }

    // Column mapping (Jan 2027 format - Stack Ref removed):
    // A=0:Drop, B=1:Serial, C=2:Timestamp, D=3:OLT Address,
    // E=4:ONT Rx, F=5:Link ONT->OLT, G=6:OLT Rx, H=7:Link OLT->ONT,
    // I=8:Status, J=9:Lat, K=10:Lon, L=11:Current ONT RX, M=12:Team
    rows.push({
      drop_number: dropNumber,
      serial_number: String(row[1] ?? '').trim(),
      activation_date: activationDate,
      activation_datetime: activationDatetime,
      olt_address: String(row[3] ?? '').trim(),
      ont_rx_sig_dbm: row[4] !== undefined ? parseFloat(row[4]) : null,
      link_budget_ont_olt_db: row[5] !== undefined ? parseFloat(row[5]) : null,
      olt_rx_sig_dbm: row[6] !== undefined ? parseFloat(row[6]) : null,
      link_budget_olt_ont_db: row[7] !== undefined ? parseFloat(row[7]) : null,
      status: String(row[8] ?? '').trim(),
      latitude: row[9] !== undefined ? parseFloat(row[9]) : null,
      longitude: row[10] !== undefined ? parseFloat(row[10]) : null,
      current_ont_rx: row[11] !== undefined ? parseFloat(row[11]) : null,
      team: String(row[12] ?? '').trim(),
    });
  }

  if (rows.length > 0) {
    const dataWarnings = validateDataSample(rows);
    warnings.push(...dataWarnings);
  }

  return { rows, warnings, headerMismatch, ppRows };
}
