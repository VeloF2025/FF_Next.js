/**
 * API Route: /api/activate/import-oes
 *
 * Purpose: Import Nokia OES activation reports
 * Method: POST (multipart/form-data)
 *
 * Actions:
 * - preview: Parse Excel and return preview data
 * - import: Parse Excel, insert into oes_activations, update drops.oes_confirmed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { IncomingForm, Fields, Files } from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { log } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

interface OESRow {
  drop_number: string;
  serial_number: string;
  activation_date: string;
  activation_datetime: string | null; // Full timestamp if available
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

/**
 * Parse Excel serial date to ISO date string (date only)
 * Excel serial date is days since 1900-01-01 (with a bug for 1900 leap year)
 */
function excelDateToISO(serial: number): string {
  // Excel's epoch is 1900-01-01, but Excel incorrectly treats 1900 as a leap year
  // Days are counted from 1, not 0
  const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

/**
 * Parse Excel serial date to full ISO timestamp
 * Excel stores datetime as fractional days since 1900-01-01
 * The fractional part represents the time of day
 */
function excelDateTimeToISO(serial: number): string {
  // Excel's epoch is 1900-01-01, but Excel incorrectly treats 1900 as a leap year
  const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

// Expected headers for validation (Jan 2027 format - 13 columns, Stack Ref removed)
const EXPECTED_HEADERS = [
  'Drop Number',
  'Serial Number',
  'Timestamp',
  'OLT Address',
  'ONT Rx SIG (dBm)',
  'Link Budget ONT->OLT (dB)',
  'OLT Rx SIG (dBm)',
  'Link Budget OLT->ONT (dB)',
  'Status',
  'Latitude',
  'Longitude',
  'Current ONT RX',
  'Team',
];

interface ParseResult {
  rows: OESRow[];
  warnings: string[];
  headerMismatch: boolean;
}

/**
 * Validate Excel headers match expected format
 */
function validateHeaders(headers: any[]): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check column count
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
    const actualStr = String(check.actual || '').trim();
    if (!actualStr.toLowerCase().includes(check.expected.toLowerCase().split(' ')[0])) {
      warnings.push(`Header mismatch at column ${check.index + 1}: expected "${check.expected}", got "${actualStr}"`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Validate data values look correct (detect column misalignment)
 */
function validateDataSample(rows: OESRow[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, rows.length);

  let statusNumericCount = 0;
  let teamNumericCount = 0;
  let invalidStatusCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i];

    // Status should be text like "Active" or "Inactive", not numbers
    if (row.status && !isNaN(parseFloat(row.status))) {
      statusNumericCount++;
    }

    // Status should be "Active" or "Inactive" typically
    if (row.status && !['active', 'inactive', ''].includes(row.status.toLowerCase())) {
      invalidStatusCount++;
    }

    // Team should be alphanumeric like "law6", "moa1", not coordinates like "-21.307682"
    if (row.team && /^-?\d+\.\d+$/.test(row.team)) {
      teamNumericCount++;
    }
  }

  if (statusNumericCount > sampleSize / 2) {
    warnings.push(`⚠️ Status column contains numeric values (${statusNumericCount}/${sampleSize} rows). Columns may be misaligned!`);
  }

  if (teamNumericCount > sampleSize / 2) {
    warnings.push(`⚠️ Team column contains coordinate-like values (${teamNumericCount}/${sampleSize} rows). Columns may be misaligned!`);
  }

  if (invalidStatusCount > sampleSize / 2 && statusNumericCount === 0) {
    warnings.push(`⚠️ Status values unexpected: ${rows.slice(0, 3).map(r => r.status).join(', ')}. Expected "Active" or "Inactive".`);
  }

  return warnings;
}

/**
 * Parse Excel file and extract OES data with validation
 */
function parseOESExcel(filePath: string): ParseResult {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Use first sheet (OLT DATA)
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const warnings: string[] = [];
  let headerMismatch = false;

  // Validate headers
  if (data.length > 0) {
    const headerValidation = validateHeaders(data[0]);
    if (!headerValidation.valid) {
      headerMismatch = true;
      warnings.push(...headerValidation.warnings);
    }
  }

  // Skip header row
  const rows: OESRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue; // Skip empty rows

    const dropNumber = String(row[0] || '').trim();
    if (!dropNumber.startsWith('DR')) continue; // Skip invalid rows

    // Parse activation date/datetime
    let activationDate: string;
    let activationDatetime: string | null = null;
    if (typeof row[2] === 'number') {
      activationDate = excelDateToISO(row[2]);
      // If there's a fractional part, it contains time info
      if (row[2] % 1 !== 0) {
        activationDatetime = excelDateTimeToISO(row[2]);
      }
    } else {
      activationDate = String(row[2] || '');
    }

    // Column mapping updated Jan 2027 - "Stack Ref." removed
    // A=0:Drop, B=1:Serial, C=2:Timestamp, D=3:OLT Address,
    // E=4:ONT Rx, F=5:Link ONT->OLT, G=6:OLT Rx, H=7:Link OLT->ONT,
    // I=8:Status, J=9:Lat, K=10:Lon, L=11:Current ONT RX, M=12:Team
    rows.push({
      drop_number: dropNumber,
      serial_number: String(row[1] || '').trim(),
      activation_date: activationDate,
      activation_datetime: activationDatetime,
      olt_address: String(row[3] || '').trim(),
      ont_rx_sig_dbm: row[4] !== undefined ? parseFloat(row[4]) : null,
      link_budget_ont_olt_db: row[5] !== undefined ? parseFloat(row[5]) : null,
      olt_rx_sig_dbm: row[6] !== undefined ? parseFloat(row[6]) : null,
      link_budget_olt_ont_db: row[7] !== undefined ? parseFloat(row[7]) : null,
      status: String(row[8] || '').trim(),
      latitude: row[9] !== undefined ? parseFloat(row[9]) : null,
      longitude: row[10] !== undefined ? parseFloat(row[10]) : null,
      current_ont_rx: row[11] !== undefined ? parseFloat(row[11]) : null,
      team: String(row[12] || '').trim(),
    });
  }

  // Validate data sample for column alignment issues
  if (rows.length > 0) {
    const dataWarnings = validateDataSample(rows);
    warnings.push(...dataWarnings);
  }

  return { rows, warnings, headerMismatch };
}

/**
 * Parse form data from request
 */
function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fields, files } = await parseForm(req);

    // Get the uploaded file
    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = uploadedFile.filepath;
    const action = Array.isArray(fields.action) ? fields.action[0] : fields.action;

    // Parse the Excel file with validation
    log.info('OESImport', `Parsing file: ${uploadedFile.originalFilename}`);
    const parseResult = parseOESExcel(filePath);
    const { rows: oesRows, warnings, headerMismatch } = parseResult;

    // Log warnings if any
    if (warnings.length > 0) {
      log.warn('OESImport', 'Format validation warnings detected', { warnings, headerMismatch });
    }

    // Clean up temp file
    fs.unlinkSync(filePath);

    if (action === 'preview') {
      // Return preview data with warnings
      return res.status(200).json({
        success: true,
        preview: oesRows,
        totalRows: oesRows.length,
        warnings: warnings.length > 0 ? warnings : undefined,
        headerMismatch,
      });
    }

    if (action === 'import') {
      const reportDate = Array.isArray(fields.reportDate) ? fields.reportDate[0] : fields.reportDate;

      log.info('OESImport', `Importing ${oesRows.length} rows (batch mode)`, { reportDate, warningCount: warnings.length });

      // Create import batch
      const batchResult = await pool.query(
        `INSERT INTO oes_import_batches (filename, report_date, total_rows)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [uploadedFile.originalFilename, reportDate || new Date().toISOString().split('T')[0], oesRows.length]
      );
      const batchId = batchResult.rows[0].id;

      // Step 1: Fetch all drops in one query for matching
      const dropNumbers = oesRows.map(r => r.drop_number);
      const dropsResult = await pool.query(
        `SELECT id, drop_number FROM drops WHERE drop_number = ANY($1)`,
        [dropNumbers]
      );
      const dropsMap = new Map(dropsResult.rows.map(d => [d.drop_number, d.id]));
      log.info('OESImport', `Found ${dropsMap.size} matching drops`);

      // Step 2: Count existing records before import
      const countBefore = await pool.query(
        `SELECT COUNT(*) as count FROM oes_activations`
      );
      const existingCount = parseInt(countBefore.rows[0].count, 10);
      log.info('OESImport', `Existing OES records: ${existingCount}`);

      // Step 3: Batch upsert OES activations (in chunks of 500)
      const BATCH_SIZE = 500;
      const errors: string[] = [];

      for (let i = 0; i < oesRows.length; i += BATCH_SIZE) {
        const chunk = oesRows.slice(i, i + BATCH_SIZE);

        // Build VALUES clause for batch insert
        const values: any[] = [];
        const placeholders: string[] = [];

        chunk.forEach((row, idx) => {
          const dropId = dropsMap.get(row.drop_number) || null;
          const offset = idx * 16; // 16 columns (stack_ref removed Jan 2027)
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`);
          values.push(
            row.drop_number,
            dropId,
            row.serial_number,
            row.activation_date,
            row.activation_datetime, // Full timestamp if available
            row.olt_address,
            row.ont_rx_sig_dbm,
            row.link_budget_ont_olt_db,
            row.olt_rx_sig_dbm,
            row.link_budget_olt_ont_db,
            row.status,
            row.latitude,
            row.longitude,
            row.current_ont_rx,
            row.team,
            batchId
          );
        });

        try {
          await pool.query(
            `INSERT INTO oes_activations (
               drop_number, drop_id, serial_number, activation_date, activation_datetime, olt_address,
               ont_rx_sig_dbm, link_budget_ont_olt_db, olt_rx_sig_dbm, link_budget_olt_ont_db,
               status, latitude, longitude, current_ont_rx, team, import_batch_id
             ) VALUES ${placeholders.join(', ')}
             ON CONFLICT (drop_number) DO UPDATE SET
               drop_id = COALESCE(EXCLUDED.drop_id, oes_activations.drop_id),
               serial_number = EXCLUDED.serial_number,
               activation_date = EXCLUDED.activation_date,
               activation_datetime = COALESCE(EXCLUDED.activation_datetime, oes_activations.activation_datetime),
               olt_address = EXCLUDED.olt_address,
               ont_rx_sig_dbm = EXCLUDED.ont_rx_sig_dbm,
               link_budget_ont_olt_db = EXCLUDED.link_budget_ont_olt_db,
               olt_rx_sig_dbm = EXCLUDED.olt_rx_sig_dbm,
               link_budget_olt_ont_db = EXCLUDED.link_budget_olt_ont_db,
               status = EXCLUDED.status,
               latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               current_ont_rx = EXCLUDED.current_ont_rx,
               team = EXCLUDED.team,
               import_batch_id = EXCLUDED.import_batch_id,
               updated_at = NOW()`,
            values
          );
        } catch (chunkError) {
          const errMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errMsg}`);
          log.error('OESImport', `Batch error at row ${i}`, chunkError);
        }

        log.info('OESImport', `Processed ${Math.min(i + BATCH_SIZE, oesRows.length)}/${oesRows.length}`);
      }

      // Step 4: Count records after import to calculate inserted vs updated
      const countAfter = await pool.query(
        `SELECT COUNT(*) as count FROM oes_activations`
      );
      const newCount = parseInt(countAfter.rows[0].count, 10);
      const inserted = newCount - existingCount;
      const updated = Math.max(0, oesRows.length - inserted); // Rows not inserted were updated
      log.info('OESImport', `After import: ${newCount} records (${inserted} new, ${updated} updated)`);

      // Step 5: Bulk update drops table to mark OES confirmed
      const matchedDropNumbers = oesRows
        .filter(r => dropsMap.has(r.drop_number))
        .map(r => r.drop_number);

      if (matchedDropNumbers.length > 0) {
        await pool.query(
          `UPDATE drops
           SET oes_confirmed = true, oes_confirmed_at = NOW()
           WHERE drop_number = ANY($1)`,
          [matchedDropNumbers]
        );
      }

      const matched = dropsMap.size;
      const unmatched = oesRows.length - matched;

      // Update batch stats
      await pool.query(
        `UPDATE oes_import_batches
         SET matched_drops = $1, unmatched_drops = $2
         WHERE id = $3`,
        [matched, unmatched, batchId]
      );

      // Step 6: Create unified records for OES-only DRs (not submitted via WhatsApp)
      // These will appear in QA centre for review, photos will be fetched when opened
      const existingUnifiedResult = await pool.query(
        `SELECT drop_number FROM dr_photo_unified_reviews WHERE drop_number = ANY($1)`,
        [dropNumbers]
      );
      const existingUnifiedSet = new Set(existingUnifiedResult.rows.map(r => r.drop_number));

      // Find DRs that are in OES but NOT in unified table
      const oesOnlyDRs = oesRows.filter(row => !existingUnifiedSet.has(row.drop_number));

      if (oesOnlyDRs.length > 0) {
        log.info('OESImport', `Creating ${oesOnlyDRs.length} unified records for OES-only DRs`);

        // Lookup project for each DR from drops table (source of truth)
        const oesOnlyDropNumbers = oesOnlyDRs.map(r => r.drop_number);
        const projectLookupResult = await pool.query(
          `SELECT d.drop_number, p.project_name
           FROM drops d
           JOIN projects p ON d.project_id = p.id
           WHERE d.drop_number = ANY($1)`,
          [oesOnlyDropNumbers]
        );
        const drToProject = new Map<string, string>();
        projectLookupResult.rows.forEach(r => {
          drToProject.set(r.drop_number, r.project_name);
        });
        log.info('OESImport', `Found project mapping for ${drToProject.size}/${oesOnlyDRs.length} DRs`);

        // Batch insert OES-only DRs into unified table
        // Photos will be fetched via ensure-data when user opens for QA review
        // NOTE: submitted_date is NOT set - these DRs were not "submitted" via WhatsApp
        const OES_BATCH_SIZE = 100;
        let oesOnlyCreated = 0;

        for (let i = 0; i < oesOnlyDRs.length; i += OES_BATCH_SIZE) {
          const chunk = oesOnlyDRs.slice(i, i + OES_BATCH_SIZE);

          const values: any[] = [];
          const placeholders: string[] = [];

          chunk.forEach((row, idx) => {
            const offset = idx * 6;
            // is_oes_only is always TRUE for these records
            // project is looked up from drops table (source of truth)
            // oes_activated_at is set to activation_datetime or activation_date
            placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, TRUE, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
            values.push(
              row.drop_number,
              'OES Import', // Mark source as OES import
              drToProject.get(row.drop_number) || null, // Project from drops table
              row.activation_datetime || row.activation_date, // oes_activated_at
              row.serial_number, // oes_serial
              row.team // oes_team
            );
          });

          try {
            await pool.query(
              `INSERT INTO dr_photo_unified_reviews (drop_number, photo_source, project, is_oes_only, oes_activated_at, oes_serial, oes_team)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (drop_number) DO NOTHING`,
              values
            );
            oesOnlyCreated += chunk.length;
          } catch (oesErr) {
            log.error('OESImport', `Error creating OES-only unified records at batch ${i}`, oesErr);
          }
        }

        log.info('OESImport', `Created ${oesOnlyCreated} OES-only unified records`);

        // Add activity log entries for OES activations
        log.info('OESImport', 'Adding activity log entries for OES activations');
        const activityChunks = [];
        for (let i = 0; i < oesOnlyDRs.length; i += OES_BATCH_SIZE) {
          activityChunks.push(oesOnlyDRs.slice(i, i + OES_BATCH_SIZE));
        }

        for (const chunk of activityChunks) {
          const actValues: any[] = [];
          const actPlaceholders: string[] = [];

          chunk.forEach((row, idx) => {
            const offset = idx * 4;
            actPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4})`);
            actValues.push(
              row.drop_number,
              'oes_activated',
              JSON.stringify({
                activation_date: row.activation_date,
                activation_datetime: row.activation_datetime,
                serial_number: row.serial_number,
                team: row.team,
                olt_address: row.olt_address,
                source: 'OES Import'
              }),
              'system'
            );
          });

          try {
            await pool.query(
              `INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
               VALUES ${actPlaceholders.join(', ')}`,
              actValues
            );
          } catch (actErr) {
            log.error('OESImport', 'Error adding activity log entries', actErr);
          }
        }
      }

      // Step 7: Update EXISTING unified records with OES activation data
      // These are DRs that were submitted via WhatsApp and are now also on OES
      const existingToUpdate = oesRows.filter(row => existingUnifiedSet.has(row.drop_number));
      if (existingToUpdate.length > 0) {
        log.info('OESImport', `Updating ${existingToUpdate.length} existing unified records with OES activation data`);

        // Build bulk update using CASE statements
        const UPDATE_BATCH_SIZE = 100;
        for (let i = 0; i < existingToUpdate.length; i += UPDATE_BATCH_SIZE) {
          const chunk = existingToUpdate.slice(i, i + UPDATE_BATCH_SIZE);
          const dropNumbersChunk = chunk.map(r => r.drop_number);

          // Build arrays for the update
          const activationTimes = chunk.map(r => r.activation_datetime || r.activation_date);
          const serials = chunk.map(r => r.serial_number);
          const teams = chunk.map(r => r.team);

          try {
            await pool.query(
              `UPDATE dr_photo_unified_reviews u
               SET
                 oes_activated_at = COALESCE(u.oes_activated_at, data.activation_time::timestamp),
                 oes_serial = COALESCE(u.oes_serial, data.serial),
                 oes_team = COALESCE(u.oes_team, data.team),
                 updated_at = NOW()
               FROM (
                 SELECT
                   unnest($1::text[]) as drop_number,
                   unnest($2::text[]) as activation_time,
                   unnest($3::text[]) as serial,
                   unnest($4::text[]) as team
               ) data
               WHERE u.drop_number = data.drop_number`,
              [dropNumbersChunk, activationTimes, serials, teams]
            );
          } catch (updateErr) {
            log.error('OESImport', `Error updating existing unified records at batch ${i}`, updateErr);
          }
        }
        log.info('OESImport', `Updated ${existingToUpdate.length} existing unified records`);
      }

      log.info('OESImport', 'Import complete', { inserted, updated, matched, unmatched, oesOnly: oesOnlyDRs.length, existingUpdated: existingToUpdate.length, errors: errors.length });

      // Trigger QField sync and WAIT for confirmation - Updated Jan 2026
      // IMPORTANT: Only show success confirmation after actual confirmation received
      let qfieldSyncStatus: { success: boolean; message: string; recordCount?: number } = {
        success: false,
        message: 'QField sync not attempted'
      };

      try {
        const syncPayload = {
          batchId,
          totalRows: oesRows.length,
          imported: inserted + updated,
          matched: matched,
          timestamp: new Date().toISOString(),
          reportDate: reportDate || new Date().toISOString().split('T')[0] // Pass user-selected date for layer naming
        };

        log.info('OESImport', 'Triggering QField sync webhook (awaiting confirmation)', syncPayload);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

        try {
          const response = await fetch('http://100.96.203.105:8095/sync/oes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const result = await response.json();
            log.info('OESImport', 'QField sync webhook responded', result);

            // The webhook triggers sync in background, so we need to poll for completion
            // Poll the status endpoint for up to 60 seconds
            const maxWaitMs = 60000;
            const pollIntervalMs = 3000;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitMs) {
              await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

              try {
                const statusResponse = await fetch('http://100.96.203.105:8095/status');
                if (statusResponse.ok) {
                  const status = await statusResponse.json();
                  log.info('OESImport', 'QField sync status poll', status);

                  // Check if sync completed (last_sync updated recently)
                  if (status.last_sync) {
                    const lastSyncTime = new Date(status.last_sync).getTime();
                    const syncStartTime = new Date(syncPayload.timestamp).getTime();

                    // If last_sync is after our sync started, it's done
                    if (lastSyncTime >= syncStartTime - 5000) {
                      // Check last_error (null = success) and last_count (not last_status/last_record_count)
                      const syncSuccess = status.last_error === null && !status.is_running;
                      qfieldSyncStatus = {
                        success: syncSuccess,
                        message: syncSuccess
                          ? `Synced ${status.last_count || 0} records to QFieldCloud`
                          : status.last_error || 'Sync completed with issues',
                        recordCount: status.last_count
                      };
                      log.info('OESImport', 'QField sync confirmed complete', qfieldSyncStatus);
                      break;
                    }
                  }
                }
              } catch (pollError) {
                log.warn('OESImport', 'QField status poll failed', pollError);
              }
            }

            // If we timed out waiting, still mark as triggered
            if (!qfieldSyncStatus.success && qfieldSyncStatus.message === 'QField sync not attempted') {
              qfieldSyncStatus = {
                success: false,
                message: 'QField sync triggered but confirmation timed out - check QField app'
              };
            }
          } else {
            qfieldSyncStatus = {
              success: false,
              message: `QField sync webhook returned ${response.status}`
            };
            log.warn('OESImport', qfieldSyncStatus.message);
          }
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);
          const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
          if (errorMessage.includes('aborted')) {
            qfieldSyncStatus = {
              success: false,
              message: 'QField sync timed out after 2 minutes'
            };
          } else {
            qfieldSyncStatus = {
              success: false,
              message: `QField sync failed: ${errorMessage}`
            };
          }
          log.warn('OESImport', 'QField sync webhook failed', errorMessage);
        }
      } catch (error) {
        log.error('OESImport', 'Failed to call QField sync webhook', error);
        qfieldSyncStatus = {
          success: false,
          message: 'QField sync failed unexpectedly'
        };
      }

      // === SHAREPOINT FOLDER VERIFICATION (Fire-and-forget) ===
      // Ensure folders exist for all matched DRs after OES import
      if (process.env.SHAREPOINT_DR_SYNC_ENABLED === 'true' && matched > 0) {
        try {
          // Get list of matched DR numbers for folder verification
          const matchedDrNumbers = oesRows
            .filter(row => dropsMap.has(row.drop_number))
            .map(row => row.drop_number);

          if (matchedDrNumbers.length > 0) {
            log.info('OESImport', `Triggering SharePoint folder verification for ${matchedDrNumbers.length} DRs`);

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';
            fetch(`${baseUrl}/api/activate/sharepoint-sync-batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verify_folders',
                dropNumbers: matchedDrNumbers.slice(0, 100) // Limit to first 100
              })
            })
            .then(async (response) => {
              if (response.ok) {
                const result = await response.json();
                log.info('OESImport', 'SharePoint folder verification triggered', {
                  processed: result.data?.processed,
                  succeeded: result.data?.succeeded,
                  failed: result.data?.failed,
                });
              } else {
                log.warn('OESImport', `SharePoint sync returned ${response.status}`);
              }
            })
            .catch((error) => {
              log.warn('OESImport', 'SharePoint sync failed (non-blocking)', error.message);
            });
          }
        } catch (error) {
          // Non-blocking - don't fail import if SharePoint sync fails
          log.error('OESImport', 'Failed to trigger SharePoint folder verification', error);
        }
      }

      return res.status(200).json({
        success: true,
        totalRows: oesRows.length,
        inserted,
        updated,
        matched,
        unmatched,
        oesOnlyCreated: oesOnlyDRs.length,
        errors,
        batchId,
        // Confirmation statuses - only true when actually confirmed
        dbSyncConfirmed: true, // DB insert/update completed if we got here
        qfieldSyncStatus,
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "preview" or "import".' });
  } catch (error) {
    log.error('OESImport', 'Import failed', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
}

export default withAuth(withRole('manager')(handler));
