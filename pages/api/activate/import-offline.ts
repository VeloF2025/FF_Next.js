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
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { IncomingForm, Fields, Files } from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

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
 * Parse Excel file and extract Offline Data
 * Supports both Summary Report and Audit Report formats
 */
function parseOfflineExcel(filePath: string): { rows: ParsedOfflineRow[]; format: ReportFormat } {
  const workbook = XLSX.readFile(filePath);

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

  log.info('OfflineImport', `Detected format: ${format}`, { sheetName, headerCount: headers.length });

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

  return { rows, format };
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fields, files } = await parseForm(req);

    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = uploadedFile.filepath;
    const action = Array.isArray(fields.action) ? fields.action[0] : fields.action;

    log.info('OfflineImport', `Parsing file: ${uploadedFile.originalFilename}`);
    const { rows: offlineRows, format: reportFormat } = parseOfflineExcel(filePath);

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
      });
    }

    if (action === 'import') {
      const reportDate =
        Array.isArray(fields.reportDate) ? fields.reportDate[0] : fields.reportDate;
      const reportDateStr = reportDate || new Date().toISOString().split('T')[0];

      log.info('OfflineImport', `Importing ${offlineRows.length} rows (${reportFormat} format)`, { reportDate: reportDateStr, reportFormat });

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

      log.info('OfflineImport', `Matching: ${dropsMap.size} drops, ${oesMap.size} OES records`);

      // Step 4: Process and insert offline devices
      const BATCH_SIZE = 100;
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

      for (let i = 0; i < offlineRows.length; i += BATCH_SIZE) {
        const chunk = offlineRows.slice(i, i + BATCH_SIZE);

        for (const row of chunk) {
          try {
            const drop = dropsMap.get(row.drop_number);
            const oes = oesMap.get(row.drop_number);

            // Determine match status
            let matchStatus = 'unmatched';
            let dropId = null;
            let oesId = null;
            let expectedSerial = null;
            let serialMismatch = false;
            let serialMismatchType = null;
            let latitude = null;
            let longitude = null;

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

              // Check for serial mismatch
              if (oes.serial_number && row.serial_number !== oes.serial_number) {
                serialMismatch = true;
                serialMismatchType = 'different_serial';
                serialMismatches++;

                // Create alert for serial mismatch
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

            // Create alert for long offline (>20 days)
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

            // Insert offline device record
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
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33
              )
              ON CONFLICT (drop_number, report_date) DO UPDATE SET
                serial_number = EXCLUDED.serial_number,
                last_down_reason = EXCLUDED.last_down_reason,
                last_inform_date = EXCLUDED.last_inform_date,
                days_since_last_inform = EXCLUDED.days_since_last_inform,
                offline_bucket = EXCLUDED.offline_bucket,
                match_status = EXCLUDED.match_status,
                expected_serial = EXCLUDED.expected_serial,
                serial_mismatch = EXCLUDED.serial_mismatch,
                serial_mismatch_type = EXCLUDED.serial_mismatch_type,
                zone = EXCLUDED.zone,
                planned_pon = EXCLUDED.planned_pon,
                address = EXCLUDED.address,
                pole_number = EXCLUDED.pole_number,
                point_of_interest = EXCLUDED.point_of_interest,
                installation_date = EXCLUDED.installation_date,
                days_since_activation = EXCLUDED.days_since_activation,
                revenue_30day_avg = EXCLUDED.revenue_30day_avg,
                source_report = EXCLUDED.source_report`,
              [
                batchId,
                row.drop_number,
                row.serial_number,
                row.area_code,
                row.ont_address,
                row.olt_rack,
                row.olt_shelf,
                row.olt_slot,
                row.olt_port,
                row.olt_ont,
                row.last_down_reason,
                row.last_inform_date,
                row.days_since_last_inform,
                row.offline_bucket,
                dropId,
                oesId,
                matchStatus,
                expectedSerial,
                serialMismatch,
                serialMismatchType,
                latitude,
                longitude,
                reportDateStr,
                row.snapshot_date,
                row.zone,
                row.planned_pon,
                row.address,
                row.pole_number,
                row.point_of_interest,
                row.installation_date,
                row.days_since_activation,
                row.revenue_30day_avg,
                row.source_report,
              ]
            );
          } catch (rowError) {
            const errMsg = rowError instanceof Error ? rowError.message : 'Unknown error';
            errors.push(`${row.drop_number}: ${errMsg}`);
          }
        }

        log.info('OfflineImport', `Processed ${Math.min(i + BATCH_SIZE, offlineRows.length)}/${offlineRows.length}`);
      }

      // Step 5: Update drops table with offline status
      const offlineDropNumbers = offlineRows
        .filter((r) => dropsMap.has(r.drop_number))
        .map((r) => r.drop_number);

      if (offlineDropNumbers.length > 0) {
        // First, reset all drops to online
        await pool.query(
          `UPDATE drops SET is_offline = false WHERE is_offline = true`
        );

        // Then mark current offline drops
        for (const row of offlineRows) {
          if (dropsMap.has(row.drop_number)) {
            await pool.query(
              `UPDATE drops SET
                is_offline = true,
                offline_reason = $1,
                offline_days = $2,
                last_offline_check = NOW()
              WHERE drop_number = $3`,
              [row.last_down_reason, row.days_since_last_inform, row.drop_number]
            );
          }
        }
      }

      // Step 6: Create alerts (deduplicated by drop_number + alert_type)
      let alertsCreated = 0;
      for (const alert of alertsToCreate) {
        try {
          await pool.query(
            `INSERT INTO offline_alerts (
              drop_number, serial_number, alert_type, severity,
              description, days_offline, last_down_reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING`,
            [
              alert.drop_number,
              alert.serial_number,
              alert.alert_type,
              alert.severity,
              alert.description,
              alert.days_offline,
              alert.last_down_reason,
            ]
          );
          alertsCreated++;
        } catch {
          // Ignore duplicate alerts
        }
      }

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

      log.info('OfflineImport', 'Import complete', {
        matchedDrops,
        matchedOes,
        unmatched,
        serialMismatches,
        alertsCreated,
        errors: errors.length,
      });

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
    log.error('OfflineImport', 'Import failed', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
}
