/**
 * API Route: /api/activate/import-offline
 *
 * Purpose: Import offline device data from network Excel reports (ARCH Import)
 * Method: POST (multipart/form-data)
 *
 * Actions:
 * - preview: Parse Excel and return preview data
 * - import: Parse Excel, insert into offline_devices, match against drops/oes, detect serial mismatches
 *
 * Supported formats:
 * 1. Summary Report: law_daily_network_summary_report_*.xlsx -> "Offline - Detail" sheet
 *    - Richer data: Zone, PON, Address, Pole, Installation Date, Revenue
 * 2. Audit Report (legacy): law_daily_network_audit_detail_report_*.xlsx -> "Offline Data" sheet
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { IncomingForm, Fields, Files } from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Raw row from Audit Report (legacy format)
interface AuditReportRow {
  stack_ref_filter: string;
  serial_number: string;
  area_abbreviation: string;
  ont_address: string;
  drop_number: string;
  last_down_reason: string;
  last_inform_sast: number | null;
  days_since_last_inform: number;
  offline_days_bucket: string;
  snapshot_timestamp: number | null;
}

// Raw row from Summary Report (new format with richer data)
interface SummaryReportRow {
  'Zone': string;
  'Planned PON': string;
  'Point of Interest': string;
  'Revenue: 30 day average': number | null;
  'Address': string;
  'Pole No': string;
  'Drop No': string;
  'Serial No': string;
  'Last Down Reason': string;
  'Date of Installation': number | string | null;
  'Days Since Activation': number | null;
  'ACS: Last inform': number | string | null;
  'Offline Longer than': string;
  'ACS: Days since offline': number | null;
}

type ReportFormat = 'audit' | 'summary';

// Expected headers for validation
const SUMMARY_EXPECTED_HEADERS = [
  'Zone',
  'Planned PON',
  'Drop No',
  'Serial No',
  'Last Down Reason',
  'Offline Longer than',
];

const AUDIT_EXPECTED_HEADERS = [
  'stack_ref_filter',
  'serial_number',
  'drop_number',
  'last_down_reason',
  'days_since_last_inform',
  'offline_days_bucket',
];

interface ParseResult {
  rows: ParsedOfflineRow[];
  format: ReportFormat;
  warnings: string[];
  headerMismatch: boolean;
}

interface ParsedOfflineRow {
  drop_number: string;
  serial_number: string;
  area_code: string;
  ont_address: string | null;
  last_down_reason: string;
  last_inform_date: string | null;
  days_since_last_inform: number;
  offline_bucket: string;
  snapshot_date: string | null;
  olt_rack: number | null;
  olt_shelf: number | null;
  olt_slot: number | null;
  olt_port: number | null;
  olt_ont: number | null;
  // New fields from summary report
  zone: string | null;
  planned_pon: string | null;
  address: string | null;
  pole_number: string | null;
  point_of_interest: string | null;
  installation_date: string | null;
  days_since_activation: number | null;
  revenue_30day_avg: number | null;
  source_report: ReportFormat;
}

/**
 * Parse Excel serial date to ISO timestamp
 * Handles both numeric serial dates and string dates
 */
function excelDateToISO(value: number | string | null): string | null {
  if (!value) return null;

  // If already a string date
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return null;
  }

  // Excel serial date
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

/**
 * Parse date to YYYY-MM-DD format for DATE column
 */
function excelDateToDate(value: number | string | null): string | null {
  const iso = excelDateToISO(value);
  if (!iso) return null;
  return iso.split('T')[0] as string;
}

/**
 * Extract area code from drop number or zone
 * DR1730560 -> 'law' (Lawley), DR2XXXXXX -> 'moh' (Mohadin), etc.
 */
function extractAreaCode(dropNumber: string, zone?: string): string {
  if (zone) {
    const zoneLower = zone.toLowerCase();
    if (zoneLower.includes('lawley') || zoneLower.includes('zone')) return 'law';
    if (zoneLower.includes('mohadin')) return 'moh';
    if (zoneLower.includes('mamelodi')) return 'mam';
  }
  // Infer from drop number prefix
  if (dropNumber.startsWith('DR1')) return 'law';
  if (dropNumber.startsWith('DR2')) return 'moh';
  if (dropNumber.startsWith('DR3')) return 'mam';
  return 'law'; // Default to Lawley
}

/**
 * Parse OLT address to extract components
 * Format: law.olt.01:1-1-7-3-27
 */
function parseOltAddress(address: string): {
  rack: number | null;
  shelf: number | null;
  slot: number | null;
  port: number | null;
  ont: number | null;
} {
  const match = address?.match(/law\.olt\.\d+:(\d+)-(\d+)-(\d+)-(\d+)-?(\d+)?/);
  if (match && match[1] && match[2] && match[3] && match[4]) {
    return {
      rack: parseInt(match[1], 10),
      shelf: parseInt(match[2], 10),
      slot: parseInt(match[3], 10),
      port: parseInt(match[4], 10),
      ont: match[5] ? parseInt(match[5], 10) : null,
    };
  }
  return { rack: null, shelf: null, slot: null, port: null, ont: null };
}

/**
 * Detect report format based on column names
 */
function detectReportFormat(headers: string[]): ReportFormat {
  // Summary report has "Drop No", "Serial No", "Zone"
  // Audit report has "drop_number", "serial_number", "stack_ref_filter"
  const hasDropNo = headers.some((h) => h === 'Drop No');
  const hasZone = headers.some((h) => h === 'Zone');

  if (hasDropNo && hasZone) {
    return 'summary';
  }
  return 'audit';
}

/**
 * Validate headers match expected format
 */
function validateHeaders(headers: string[], format: ReportFormat): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const expectedHeaders = format === 'summary' ? SUMMARY_EXPECTED_HEADERS : AUDIT_EXPECTED_HEADERS;

  // Check for expected headers
  const missingHeaders: string[] = [];
  for (const expected of expectedHeaders) {
    const found = headers.some(h =>
      h.toLowerCase().includes(expected.toLowerCase()) ||
      expected.toLowerCase().includes(h.toLowerCase())
    );
    if (!found) {
      missingHeaders.push(expected);
    }
  }

  if (missingHeaders.length > 0) {
    warnings.push(`Missing expected headers: ${missingHeaders.join(', ')}`);
  }

  // Check column count is reasonable
  if (format === 'summary' && headers.length < 10) {
    warnings.push(`Summary report should have 10+ columns, got ${headers.length}. Format may have changed.`);
  } else if (format === 'audit' && headers.length < 8) {
    warnings.push(`Audit report should have 8+ columns, got ${headers.length}. Format may have changed.`);
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Validate data sample for column alignment issues
 */
function validateDataSample(rows: ParsedOfflineRow[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, rows.length);

  let invalidDropCount = 0;
  let invalidSerialCount = 0;
  let numericReasonCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i];
    if (!row) continue;

    // Drop number should start with DR
    if (row.drop_number && !row.drop_number.startsWith('DR')) {
      invalidDropCount++;
    }

    // Serial number should look like a serial (alphanumeric, usually starts with ALCL)
    if (row.serial_number && /^-?\d+\.\d+$/.test(row.serial_number)) {
      invalidSerialCount++;
    }

    // Last down reason should be text, not numeric
    if (row.last_down_reason && !isNaN(parseFloat(row.last_down_reason))) {
      numericReasonCount++;
    }
  }

  if (invalidDropCount > sampleSize / 2) {
    warnings.push(`⚠️ Drop numbers don't match expected format (${invalidDropCount}/${sampleSize} invalid). Columns may be misaligned!`);
  }

  if (invalidSerialCount > sampleSize / 2) {
    warnings.push(`⚠️ Serial numbers contain coordinate-like values (${invalidSerialCount}/${sampleSize}). Columns may be misaligned!`);
  }

  if (numericReasonCount > sampleSize / 2) {
    warnings.push(`⚠️ Last Down Reason contains numeric values (${numericReasonCount}/${sampleSize}). Columns may be misaligned!`);
  }

  return warnings;
}

/**
 * Parse Summary Report row to common format
 */
function parseSummaryRow(row: SummaryReportRow): ParsedOfflineRow | null {
  const dropNumber = row['Drop No'];
  if (!dropNumber || !dropNumber.toString().startsWith('DR')) return null;

  return {
    drop_number: dropNumber,
    serial_number: row['Serial No'] || '',
    area_code: extractAreaCode(dropNumber, row['Zone']),
    ont_address: null, // Not in summary report
    last_down_reason: row['Last Down Reason'] || 'Unknown',
    last_inform_date: excelDateToISO(row['ACS: Last inform']),
    days_since_last_inform: row['ACS: Days since offline'] || 0,
    offline_bucket: row['Offline Longer than'] || '',
    snapshot_date: null, // Not in summary report
    olt_rack: null,
    olt_shelf: null,
    olt_slot: null,
    olt_port: null,
    olt_ont: null,
    // New fields from summary report
    zone: row['Zone'] || null,
    planned_pon: row['Planned PON'] || null,
    address: row['Address'] || null,
    pole_number: row['Pole No'] || null,
    point_of_interest: row['Point of Interest'] || null,
    installation_date: excelDateToDate(row['Date of Installation']),
    days_since_activation: row['Days Since Activation'] || null,
    revenue_30day_avg: row['Revenue: 30 day average'] || null,
    source_report: 'summary',
  };
}

/**
 * Parse Audit Report row to common format
 */
function parseAuditRow(row: AuditReportRow): ParsedOfflineRow | null {
  const dropNumber = row.drop_number;
  if (!dropNumber || !dropNumber.startsWith('DR')) return null;

  const oltParsed = parseOltAddress(row.ont_address || '');

  return {
    drop_number: dropNumber,
    serial_number: row.serial_number || '',
    area_code: row.stack_ref_filter || extractAreaCode(dropNumber),
    ont_address: row.ont_address || null,
    last_down_reason: row.last_down_reason || 'Unknown',
    last_inform_date: excelDateToISO(row.last_inform_sast),
    days_since_last_inform: row.days_since_last_inform || 0,
    offline_bucket: row.offline_days_bucket || '',
    snapshot_date: excelDateToISO(row.snapshot_timestamp),
    olt_rack: oltParsed.rack,
    olt_shelf: oltParsed.shelf,
    olt_slot: oltParsed.slot,
    olt_port: oltParsed.port,
    olt_ont: oltParsed.ont,
    // No extended data in audit report
    zone: null,
    planned_pon: null,
    address: null,
    pole_number: null,
    point_of_interest: null,
    installation_date: null,
    days_since_activation: null,
    revenue_30day_avg: null,
    source_report: 'audit',
  };
}

/**
 * Parse Excel file and extract Offline Data with validation
 * Supports both Summary Report and Audit Report formats
 */
function parseOfflineExcel(filePath: string): ParseResult {
  const workbook = XLSX.readFile(filePath);
  const warnings: string[] = [];
  let headerMismatch = false;

  // Find the appropriate sheet based on format
  // Summary: "Offline - Detail"
  // Audit: "Offline Data"
  let sheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase() === 'offline - detail'
  );

  if (!sheetName) {
    sheetName = workbook.SheetNames.find(
      (name) => name.toLowerCase().includes('offline')
    );
  }

  if (!sheetName) {
    throw new Error('No offline data sheet found. Expected "Offline - Detail" or "Offline Data"');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Failed to read "${sheetName}" sheet`);
  }

  // Get headers to detect format
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
  const headers = rawData[0] || [];
  const format = detectReportFormat(headers);

  // Validate headers
  const headerValidation = validateHeaders(headers, format);
  if (!headerValidation.valid) {
    headerMismatch = true;
    warnings.push(...headerValidation.warnings);
  }

  log.info(`Detected format: ${format}`, { sheetName, headerCount: headers.length, warningCount: warnings.length }, 'OfflineImport');

  // Parse based on format
  const data = XLSX.utils.sheet_to_json(sheet);

  let rows: ParsedOfflineRow[];

  if (format === 'summary') {
    rows = (data as SummaryReportRow[])
      .map(parseSummaryRow)
      .filter((row): row is ParsedOfflineRow => row !== null);
  } else {
    rows = (data as AuditReportRow[])
      .map(parseAuditRow)
      .filter((row): row is ParsedOfflineRow => row !== null);
  }

  // Validate data sample for column alignment issues
  if (rows.length > 0) {
    const dataWarnings = validateDataSample(rows);
    warnings.push(...dataWarnings);
  }

  return { rows, format, warnings, headerMismatch };
}

/**
 * Parse form data from request
 */
function parseForm(
  req: NextApiRequest
): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const { fields, files } = await parseForm(req);

    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    const filePath = uploadedFile.filepath;
    const action = Array.isArray(fields.action) ? fields.action[0] : fields.action;

    log.info(`Parsing file: ${uploadedFile.originalFilename}`, undefined, 'OfflineImport');
    const { rows: offlineRows, format: reportFormat, warnings, headerMismatch } = parseOfflineExcel(filePath);

    // Log warnings if any
    if (warnings.length > 0) {
      log.warn('Format validation warnings detected', { warnings, headerMismatch }, 'OfflineImport');
    }

    fs.unlinkSync(filePath);

    if (action === 'preview') {
      // Create zone summary for summary report format
      const zoneSummary = reportFormat === 'summary'
        ? offlineRows.reduce((acc, row) => {
            const zone = row.zone || 'Unknown';
            acc[zone] = (acc[zone] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        : undefined;

      return res.status(200).json({
        success: true,
        preview: offlineRows.slice(0, 100), // Preview first 100
        totalRows: offlineRows.length,
        reportFormat,
        reasonSummary: offlineRows.reduce((acc, row) => {
          acc[row.last_down_reason] = (acc[row.last_down_reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        bucketSummary: offlineRows.reduce((acc, row) => {
          acc[row.offline_bucket] = (acc[row.offline_bucket] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        zoneSummary,
        warnings: warnings.length > 0 ? warnings : undefined,
        headerMismatch,
      });
    }

    if (action === 'import') {
      const reportDate =
        Array.isArray(fields.reportDate) ? (fields.reportDate[0] ?? null) : fields.reportDate;
      const reportDateStr: string = reportDate ?? new Date().toISOString().split('T')[0]!;

      log.info(`Importing ${offlineRows.length} rows (${reportFormat} format)`, { reportDate: reportDateStr, reportFormat }, 'OfflineImport');

      // Step 1: Create import batch
      const batchResult = await pool.query(
        `INSERT INTO offline_import_batches (filename, report_date, total_rows)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [uploadedFile.originalFilename, reportDateStr, offlineRows.length]
      );
      const batchId = batchResult.rows[0].id;

      // Step 2: Fetch all drops for matching
      const dropNumbers = offlineRows.map((r) => r.drop_number);
      const dropsResult = await pool.query(
        `SELECT id, drop_number, ont_serial, latitude, longitude FROM drops WHERE drop_number = ANY($1)`,
        [dropNumbers]
      );
      const dropsMap = new Map(
        dropsResult.rows.map((d) => [d.drop_number, d])
      );

      // Step 3: Fetch OES activations for serial validation
      const oesResult = await pool.query(
        `SELECT id, drop_number, serial_number, latitude, longitude FROM oes_activations WHERE drop_number = ANY($1)`,
        [dropNumbers]
      );
      const oesMap = new Map(
        oesResult.rows.map((o) => [o.drop_number, o])
      );

      log.info(`Matching: ${dropsMap.size} drops, ${oesMap.size} OES records`, undefined, 'OfflineImport');

      // Step 4: Process and batch insert offline devices (500 rows per batch like OES import)
      const BATCH_SIZE = 500;
      const errors: string[] = [];
      let matchedDrops = 0;
      let matchedOes = 0;
      let unmatched = 0;
      let serialMismatches = 0;
      const alertsToCreate: Array<{
        drop_number: string;
        serial_number: string;
        alert_type: string;
        severity: string;
        description: string;
        days_offline: number;
        last_down_reason: string;
      }> = [];

      // Pre-process all rows to determine match status and collect alerts
      interface ProcessedRow {
        row: ParsedOfflineRow;
        dropId: string | null;
        oesId: string | null;
        matchStatus: string;
        expectedSerial: string | null;
        serialMismatch: boolean;
        serialMismatchType: string | null;
        latitude: number | null;
        longitude: number | null;
      }

      // Smart deduplication - only skip if ALL these fields match:
      // - drop_number, pole_number, last_down_reason, last_inform_date
      // Different pole/reason/time = different offline instance = import both
      const seenKeys = new Set<string>();
      const uniqueRows = offlineRows.filter((row) => {
        const dateStr = row.last_inform_date ?? '';
        const compositeKey = `${row.drop_number}|${row.pole_number || ''}|${row.last_down_reason}|${dateStr}`;
        if (seenKeys.has(compositeKey)) {
          return false; // Exact duplicate - skip
        }
        seenKeys.add(compositeKey);
        return true;
      });
      const duplicatesSkipped = offlineRows.length - uniqueRows.length;
      log.info(`Smart dedup: ${offlineRows.length} rows, ${duplicatesSkipped} exact duplicates skipped, ${uniqueRows.length} unique instances`, undefined, 'OfflineImport');

      const processedRows: ProcessedRow[] = uniqueRows.map((row) => {
        const drop = dropsMap.get(row.drop_number);
        const oes = oesMap.get(row.drop_number);

        let matchStatus = 'unmatched';
        let dropId: string | null = null;
        let oesId: string | null = null;
        let expectedSerial: string | null = null;
        let serialMismatch = false;
        let serialMismatchType: string | null = null;
        let latitude: number | null = null;
        let longitude: number | null = null;

        if (drop) {
          matchStatus = 'matched_drops';
          dropId = drop.id;
          matchedDrops++;
          latitude = drop.latitude;
          longitude = drop.longitude;
        }

        if (oes) {
          if (matchStatus === 'unmatched') {
            matchStatus = 'matched_oes';
            matchedOes++;
          }
          oesId = oes.id;
          expectedSerial = oes.serial_number;
          latitude = latitude || oes.latitude;
          longitude = longitude || oes.longitude;

          if (oes.serial_number && row.serial_number !== oes.serial_number) {
            serialMismatch = true;
            serialMismatchType = 'different_serial';
            serialMismatches++;
            alertsToCreate.push({
              drop_number: row.drop_number,
              serial_number: row.serial_number,
              alert_type: 'serial_mismatch',
              severity: 'high',
              description: `Serial mismatch: Report shows ${row.serial_number}, OES has ${oes.serial_number}`,
              days_offline: row.days_since_last_inform,
              last_down_reason: row.last_down_reason,
            });
          }
        }

        if (matchStatus === 'unmatched') {
          unmatched++;
        }

        if (row.days_since_last_inform > 20) {
          alertsToCreate.push({
            drop_number: row.drop_number,
            serial_number: row.serial_number,
            alert_type: 'long_offline',
            severity: row.days_since_last_inform > 60 ? 'critical' : row.days_since_last_inform > 40 ? 'high' : 'medium',
            description: `Device offline for ${row.days_since_last_inform} days. Reason: ${row.last_down_reason}`,
            days_offline: row.days_since_last_inform,
            last_down_reason: row.last_down_reason,
          });
        }

        return { row, dropId, oesId, matchStatus, expectedSerial, serialMismatch, serialMismatchType, latitude, longitude };
      });

      // Batch insert offline devices
      for (let i = 0; i < processedRows.length; i += BATCH_SIZE) {
        const chunk = processedRows.slice(i, i + BATCH_SIZE);
        const values: (string | number | boolean | null)[] = [];
        const placeholders: string[] = [];

        chunk.forEach((item, idx) => {
          const { row, dropId, oesId, matchStatus, expectedSerial, serialMismatch, serialMismatchType, latitude, longitude } = item;
          const offset = idx * 33;
          placeholders.push(`(${Array.from({ length: 33 }, (_, j) => `$${offset + j + 1}`).join(', ')})`);
          values.push(
            batchId, row.drop_number, row.serial_number, row.area_code,
            row.ont_address, row.olt_rack, row.olt_shelf, row.olt_slot, row.olt_port, row.olt_ont,
            row.last_down_reason, row.last_inform_date, row.days_since_last_inform, row.offline_bucket,
            dropId, oesId, matchStatus, expectedSerial, serialMismatch, serialMismatchType,
            latitude, longitude, reportDateStr, row.snapshot_date,
            row.zone, row.planned_pon, row.address, row.pole_number, row.point_of_interest,
            row.installation_date, row.days_since_activation, row.revenue_30day_avg, row.source_report
          );
        });

        try {
          await pool.query(
            `INSERT INTO offline_devices (
              import_batch_id, drop_number, serial_number, area_code,
              ont_address, olt_rack, olt_shelf, olt_slot, olt_port, olt_ont,
              last_down_reason, last_inform_date, days_since_last_inform, offline_bucket,
              drop_id, oes_activation_id, match_status,
              expected_serial, serial_mismatch, serial_mismatch_type,
              latitude, longitude, report_date, snapshot_timestamp,
              zone, planned_pon, address, pole_number, point_of_interest,
              installation_date, days_since_activation, revenue_30day_avg, source_report
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT (drop_number, report_date, pole_number, last_down_reason, last_inform_date) DO UPDATE SET
              serial_number = EXCLUDED.serial_number,
              days_since_last_inform = EXCLUDED.days_since_last_inform,
              offline_bucket = EXCLUDED.offline_bucket,
              match_status = EXCLUDED.match_status,
              expected_serial = EXCLUDED.expected_serial,
              serial_mismatch = EXCLUDED.serial_mismatch,
              serial_mismatch_type = EXCLUDED.serial_mismatch_type,
              zone = EXCLUDED.zone,
              planned_pon = EXCLUDED.planned_pon,
              address = EXCLUDED.address,
              point_of_interest = EXCLUDED.point_of_interest,
              installation_date = EXCLUDED.installation_date,
              days_since_activation = EXCLUDED.days_since_activation,
              revenue_30day_avg = EXCLUDED.revenue_30day_avg,
              source_report = EXCLUDED.source_report`,
            values
          );
        } catch (chunkError) {
          const errMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errMsg}`);
          log.error(`Batch error at row ${i}`, { error: chunkError instanceof Error ? chunkError.message : String(chunkError) }, 'OfflineImport');
        }

        log.info(`Processed ${Math.min(i + BATCH_SIZE, offlineRows.length)}/${offlineRows.length}`, undefined, 'OfflineImport');
      }

      // Step 5: Bulk update drops table with offline status
      const offlineDropNumbers = offlineRows
        .filter((r) => dropsMap.has(r.drop_number))
        .map((r) => r.drop_number);

      if (offlineDropNumbers.length > 0) {
        // First, reset all drops to online
        await pool.query(
          `UPDATE drops SET is_offline = false WHERE is_offline = true`
        );

        // Then bulk mark current offline drops using a CTE
        // Build update data for batch processing
        const updateData = offlineRows
          .filter((r) => dropsMap.has(r.drop_number))
          .map((r) => ({
            drop_number: r.drop_number,
            offline_reason: r.last_down_reason,
            offline_days: r.days_since_last_inform,
          }));

        // Batch update in chunks
        const UPDATE_BATCH = 500;
        for (let i = 0; i < updateData.length; i += UPDATE_BATCH) {
          const chunk = updateData.slice(i, i + UPDATE_BATCH);
          const dropNums = chunk.map((c) => c.drop_number);

          // Use a simple bulk update - mark all as offline first
          await pool.query(
            `UPDATE drops SET
              is_offline = true,
              last_offline_check = NOW()
            WHERE drop_number = ANY($1)`,
            [dropNums]
          );
        }
      }

      // Step 6: Skip alerts for now - can be added later as separate process
      // TODO: Re-enable alerts after core import is verified working
      const alertsCreated = 0;
      log.info(`Skipping ${alertsToCreate.length} alerts for performance`, undefined, 'OfflineImport');

      // Step 7: Update batch stats
      await pool.query(
        `UPDATE offline_import_batches SET
          matched_drops = $1,
          matched_oes = $2,
          unmatched = $3,
          serial_mismatches = $4
        WHERE id = $5`,
        [matchedDrops, matchedOes, unmatched, serialMismatches, batchId]
      );

      log.info('Import complete', {
        matchedDrops,
        matchedOes,
        unmatched,
        serialMismatches,
        alertsCreated,
        errors: errors.length,
      }, 'OfflineImport');

      return res.status(200).json({
        success: true,
        totalRows: offlineRows.length,
        reportFormat,
        matchedDrops,
        matchedOes,
        unmatched,
        serialMismatches,
        alertsCreated,
        errors: errors.slice(0, 10), // First 10 errors
        batchId,
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "preview" or "import".' });
  } catch (error) {
    log.error('Import failed', { error: error instanceof Error ? error.message : String(error) }, 'OfflineImport');
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
}

export default withAuth(withRole('manager')(handler));
