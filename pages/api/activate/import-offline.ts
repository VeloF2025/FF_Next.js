/**
 * API Route: /api/activate/import-offline
 *
 * Purpose: Import offline device data from network audit Excel reports
 * Method: POST (multipart/form-data)
 *
 * Actions:
 * - preview: Parse Excel and return preview data
 * - import: Parse Excel, insert into offline_devices, match against drops/oes, detect serial mismatches
 *
 * Source: law_daily_network_audit_detail_report_*.xlsx -> "Offline Data" sheet
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

interface OfflineRow {
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

interface ParsedOfflineRow extends OfflineRow {
  last_inform_date: string | null;
  snapshot_date: string | null;
  olt_rack: number | null;
  olt_shelf: number | null;
  olt_slot: number | null;
  olt_port: number | null;
  olt_ont: number | null;
}

/**
 * Parse Excel serial date to ISO timestamp
 */
function excelDateToISO(serial: number | null): string | null {
  if (!serial) return null;
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString();
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
  if (match) {
    return {
      rack: parseInt(match[1]) || null,
      shelf: parseInt(match[2]) || null,
      slot: parseInt(match[3]) || null,
      port: parseInt(match[4]) || null,
      ont: match[5] ? parseInt(match[5]) : null,
    };
  }
  return { rack: null, shelf: null, slot: null, port: null, ont: null };
}

/**
 * Parse Excel file and extract Offline Data
 */
function parseOfflineExcel(filePath: string): ParsedOfflineRow[] {
  const workbook = XLSX.readFile(filePath);

  // Find "Offline Data" sheet
  const sheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase().includes('offline')
  );

  if (!sheetName) {
    throw new Error('Sheet "Offline Data" not found in Excel file');
  }

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet) as OfflineRow[];

  const rows: ParsedOfflineRow[] = data
    .filter((row) => row.drop_number && row.drop_number.startsWith('DR'))
    .map((row) => {
      const oltParsed = parseOltAddress(row.ont_address || '');
      return {
        ...row,
        last_inform_date: excelDateToISO(row.last_inform_sast),
        snapshot_date: excelDateToISO(row.snapshot_timestamp),
        olt_rack: oltParsed.rack,
        olt_shelf: oltParsed.shelf,
        olt_slot: oltParsed.slot,
        olt_port: oltParsed.port,
        olt_ont: oltParsed.ont,
      };
    });

  return rows;
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
    const offlineRows = parseOfflineExcel(filePath);

    fs.unlinkSync(filePath);

    if (action === 'preview') {
      return res.status(200).json({
        success: true,
        preview: offlineRows.slice(0, 100), // Preview first 100
        totalRows: offlineRows.length,
        reasonSummary: offlineRows.reduce((acc, row) => {
          acc[row.last_down_reason] = (acc[row.last_down_reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        bucketSummary: offlineRows.reduce((acc, row) => {
          acc[row.offline_days_bucket] = (acc[row.offline_days_bucket] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      });
    }

    if (action === 'import') {
      const reportDate =
        Array.isArray(fields.reportDate) ? fields.reportDate[0] : fields.reportDate;
      const reportDateStr = reportDate || new Date().toISOString().split('T')[0];

      log.info('OfflineImport', `Importing ${offlineRows.length} rows`, { reportDate: reportDateStr });

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
                latitude, longitude, report_date, snapshot_timestamp
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24
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
                serial_mismatch_type = EXCLUDED.serial_mismatch_type`,
              [
                batchId,
                row.drop_number,
                row.serial_number,
                row.stack_ref_filter,
                row.ont_address,
                row.olt_rack,
                row.olt_shelf,
                row.olt_slot,
                row.olt_port,
                row.olt_ont,
                row.last_down_reason,
                row.last_inform_date,
                row.days_since_last_inform,
                row.offline_days_bucket,
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
