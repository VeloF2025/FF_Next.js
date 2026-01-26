/**
 * OLT Report Import API
 *
 * POST: Import Nokia OLT report Excel file
 *
 * Parses the Excel and:
 * - Finds "Not Match" entries in column 20 ("Drop & ONT SN on 1Map matches to OLT?")
 * - Gets correct OLT serial from column 1
 * - Gets wrong 1Map serial from column 21
 * - Updates offline_devices.olt_serial for comparison
 * - SKIPS rows with empty OLT serial but logs to DR timeline
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logActivity } from '@/modules/activate/services/activityLogService';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

interface OltRecord {
  drNumber: string;
  oltSerial: string | null;
  matchStatus: string;
  wrongOneMapSerial: string | null;
  rowIndex: number;
  hasUpsSwap: boolean; // True if wrongOneMapSerial starts with GU18 (UPS serial in ONT field)
}

// Helper to detect UPS serial pattern (starts with GU18)
function isUpsSerial(serial: string | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
}

interface ImportResult {
  success: boolean;
  importId: string;
  filename: string;
  stats: {
    totalRecords: number;
    matchCount: number;
    mismatchCount: number;
    emptySerialCount: number;
    notFoundCount: number;
    updatedCount: number;
    alreadyFixedCount: number;
    alreadyPendingCount: number;
    needsReinvestigationCount: number;
  };
  mismatches: Array<{
    drNumber: string;
    oltSerial: string | null;
    wrongSerial: string | null;
    status: 'updated' | 'empty_serial' | 'not_found' | 'already_fixed' | 'already_pending' | 'needs_reinvestigation';
  }>;
  warnings?: string[];
}

// Expected header keywords for key columns
const EXPECTED_COLUMN_HINTS = {
  0: ['drop', 'dr'], // Column A - Drop Number
  1: ['serial', 'ont'], // Column B - OLT Serial
  20: ['match', '1map', 'olt'], // Column U - Match Status
  21: ['wrong', 'serial', '1map'], // Column V - Wrong 1Map Serial
};

interface ParseResult {
  records: OltRecord[];
  warnings: string[];
  headerMismatch: boolean;
}

/**
 * Validate OLT Report headers at key column positions
 */
function validateOltHeaders(headers: string[]): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check minimum column count
  if (headers.length < 22) {
    warnings.push(`Column count mismatch: expected at least 22, got ${headers.length}. Format may have changed.`);
    return { valid: false, warnings };
  }

  // Check key columns contain expected keywords
  for (const [colIndex, keywords] of Object.entries(EXPECTED_COLUMN_HINTS)) {
    const idx = parseInt(colIndex);
    const header = String(headers[idx] || '').toLowerCase();
    const hasKeyword = keywords.some(kw => header.includes(kw));

    if (!hasKeyword && header.length > 0) {
      const colLetter = String.fromCharCode(65 + idx);
      warnings.push(`Column ${colLetter} (${idx + 1}): expected "${keywords.join('/')}" related, got "${headers[idx]}"`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Validate OLT data sample for column alignment issues
 */
function validateOltDataSample(records: OltRecord[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, records.length);

  let invalidDrCount = 0;
  let numericMatchStatusCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const record = records[i];

    // DR number should match pattern
    if (!record.drNumber.match(/^DR\d+$/i)) {
      invalidDrCount++;
    }

    // Match status should be text like "Match" or "Not Match", not numeric
    if (record.matchStatus && !isNaN(parseFloat(record.matchStatus))) {
      numericMatchStatusCount++;
    }
  }

  if (invalidDrCount > sampleSize / 2) {
    warnings.push(`⚠️ DR numbers don't match expected format (${invalidDrCount}/${sampleSize} invalid). Columns may be misaligned!`);
  }

  if (numericMatchStatusCount > sampleSize / 2) {
    warnings.push(`⚠️ Match Status contains numeric values (${numericMatchStatusCount}/${sampleSize}). Columns may be misaligned!`);
  }

  return warnings;
}

async function parseExcelFile(filePath: string): Promise<ParseResult> {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  const warnings: string[] = [];
  let headerMismatch = false;

  // Validate headers
  const headers = data[0] || [];
  const headerValidation = validateOltHeaders(headers);
  if (!headerValidation.valid) {
    headerMismatch = true;
    warnings.push(...headerValidation.warnings);
  }

  const records: OltRecord[] = [];

  // Skip header row, start from row 1
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 21) continue;

    const drNumber = String(row[0] || '').trim();
    const oltSerial = String(row[1] || '').trim() || null;
    const matchStatus = String(row[20] || '').trim();
    const wrongOneMapSerial = String(row[21] || '').trim() || null;

    // Only include if it's a valid DR number
    if (drNumber && drNumber.match(/^DR\d+$/i)) {
      records.push({
        drNumber: drNumber.toUpperCase(),
        oltSerial,
        matchStatus,
        wrongOneMapSerial,
        rowIndex: i + 1, // 1-based for user display
        hasUpsSwap: isUpsSerial(wrongOneMapSerial), // Detect UPS serial in ONT field
      });
    }
  }

  // Validate data sample
  if (records.length > 0) {
    const dataWarnings = validateOltDataSample(records);
    warnings.push(...dataWarnings);
  }

  return { records, warnings, headerMismatch };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const client = await pool.connect();
  const user = getAuthUser(req);

  try {
    // Parse form data with file upload
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    const project = Array.isArray(fields.project)
      ? fields.project[0]
      : fields.project || null;

    // Parse Excel file with validation
    log.info('OltReportImport', 'Parsing Excel file', { filename: file.originalFilename });
    const { records, warnings, headerMismatch } = await parseExcelFile(file.filepath);

    // Log warnings if any
    if (warnings.length > 0) {
      log.warn('OltReportImport', 'Format validation warnings detected', { warnings, headerMismatch });
    }

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    if (records.length === 0) {
      return apiResponse.badRequest(res, 'No valid records found in Excel file' + (warnings.length > 0 ? `. Warnings: ${warnings.join('; ')}` : ''));
    }

    // Start transaction
    await client.query('BEGIN');

    // Count matches vs mismatches
    const matches = records.filter((r) => r.matchStatus.toLowerCase() !== 'not match');
    const mismatches = records.filter((r) => r.matchStatus.toLowerCase() === 'not match');

    // Create import record
    const importResult = await client.query(
      `INSERT INTO olt_report_imports
        (filename, project, total_records, match_count, mismatch_count, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        file.originalFilename,
        project,
        records.length,
        matches.length,
        mismatches.length,
        user?.id || null,
      ]
    );
    const importId = importResult.rows[0].id;

    // Process mismatches - check for duplicates before inserting
    const results: ImportResult['mismatches'] = [];
    let emptySerialCount = 0;
    let notFoundCount = 0;
    let updatedCount = 0;
    let alreadyFixedCount = 0;
    let alreadyPendingCount = 0;
    let needsReinvestigationCount = 0;

    for (const mismatch of mismatches) {
      // Check if this DR already exists in olt_mismatch_records
      const existingRecord = await client.query(
        `SELECT id, fix_status, olt_serial, fix_old_value
         FROM olt_mismatch_records
         WHERE drop_number = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [mismatch.drNumber]
      );

      if (existingRecord.rows.length > 0) {
        const existing = existingRecord.rows[0];

        if (existing.fix_status === 'fixed') {
          // DR was already fixed - check if the serial matches
          const existingOltSerial = existing.olt_serial?.toUpperCase();
          const newOltSerial = mismatch.oltSerial?.toUpperCase();

          if (existingOltSerial === newOltSerial) {
            // Same serial, already fixed - skip
            alreadyFixedCount++;
            results.push({
              drNumber: mismatch.drNumber,
              oltSerial: mismatch.oltSerial,
              wrongSerial: mismatch.wrongOneMapSerial,
              status: 'already_fixed',
            });
            continue;
          } else {
            // Different serial after fix - needs reinvestigation
            // Insert new record with needs_reinvestigation status
            await client.query(
              `INSERT INTO olt_mismatch_records
                (import_id, drop_number, olt_serial, wrong_onemap_serial, row_index, fix_status, has_ups_swap)
               VALUES ($1, $2, $3, $4, $5, 'needs_reinvestigation', $6)`,
              [importId, mismatch.drNumber, mismatch.oltSerial, mismatch.wrongOneMapSerial, mismatch.rowIndex, mismatch.hasUpsSwap]
            );

            await logActivity(
              mismatch.drNumber,
              'INVESTIGATE',
              {
                message: `New OLT serial mismatch after previous fix. Previous: ${existingOltSerial}, New: ${newOltSerial}`,
                source: 'olt_report_import',
                previousSerial: existingOltSerial,
                newSerial: newOltSerial,
              },
              user?.id || 'system'
            );

            needsReinvestigationCount++;
            results.push({
              drNumber: mismatch.drNumber,
              oltSerial: mismatch.oltSerial,
              wrongSerial: mismatch.wrongOneMapSerial,
              status: 'needs_reinvestigation',
            });
            continue;
          }
        } else if (existing.fix_status === 'pending' || existing.fix_status === 'empty_serial') {
          // Already pending - update serial data but keep original import_id for audit trail
          const newFixStatus = !mismatch.oltSerial ? 'empty_serial' : 'pending';
          await client.query(
            `UPDATE olt_mismatch_records
             SET olt_serial = $1,
                 wrong_onemap_serial = $2,
                 row_index = $3,
                 fix_status = $4,
                 has_ups_swap = $5
             WHERE id = $6`,
            [mismatch.oltSerial, mismatch.wrongOneMapSerial, mismatch.rowIndex, newFixStatus, mismatch.hasUpsSwap, existing.id]
          );

          alreadyPendingCount++;
          results.push({
            drNumber: mismatch.drNumber,
            oltSerial: mismatch.oltSerial,
            wrongSerial: mismatch.wrongOneMapSerial,
            status: 'already_pending',
          });
          continue;
        }
        // For other statuses (not_found, needs_reinvestigation), allow new insert
      }

      // New DR - insert into olt_mismatch_records
      let fixStatus = 'pending';
      if (!mismatch.oltSerial) {
        fixStatus = 'empty_serial';
        emptySerialCount++;
      }

      await client.query(
        `INSERT INTO olt_mismatch_records
          (import_id, drop_number, olt_serial, wrong_onemap_serial, row_index, fix_status, has_ups_swap)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [importId, mismatch.drNumber, mismatch.oltSerial, mismatch.wrongOneMapSerial, mismatch.rowIndex, fixStatus, mismatch.hasUpsSwap]
      );

      // Handle empty OLT serial - log but don't try to update offline_devices
      if (!mismatch.oltSerial) {
        await logActivity(
          mismatch.drNumber,
          'error',
          {
            message: 'OLT report shows empty serial - requires investigation',
            source: 'olt_report_import',
          },
          user?.id || 'system'
        );

        results.push({
          drNumber: mismatch.drNumber,
          oltSerial: null,
          wrongSerial: mismatch.wrongOneMapSerial,
          status: 'empty_serial',
        });
        continue;
      }

      // Try to update offline_devices if DR exists there
      const updateResult = await client.query(
        `UPDATE offline_devices
         SET olt_serial = $1,
             olt_report_id = $2,
             olt_imported_at = NOW(),
             olt_wrong_onemap_serial = $4
         WHERE drop_number = $3
         RETURNING id`,
        [mismatch.oltSerial, importId, mismatch.drNumber, mismatch.wrongOneMapSerial]
      );

      if (updateResult.rowCount === 0) {
        // DR not in offline_devices - that's OK, it's tracked in olt_mismatch_records
        notFoundCount++;
        results.push({
          drNumber: mismatch.drNumber,
          oltSerial: mismatch.oltSerial,
          wrongSerial: mismatch.wrongOneMapSerial,
          status: 'not_found',
        });
      } else {
        updatedCount++;
        results.push({
          drNumber: mismatch.drNumber,
          oltSerial: mismatch.oltSerial,
          wrongSerial: mismatch.wrongOneMapSerial,
          status: 'updated',
        });
      }
    }

    // Update import stats
    await client.query(
      `UPDATE olt_report_imports
       SET empty_serial_count = $1,
           not_found_count = $2
       WHERE id = $3`,
      [emptySerialCount, notFoundCount, importId]
    );

    await client.query('COMMIT');

    const response: ImportResult = {
      success: true,
      importId,
      filename: file.originalFilename || 'unknown',
      stats: {
        totalRecords: records.length,
        matchCount: matches.length,
        mismatchCount: mismatches.length,
        emptySerialCount,
        notFoundCount,
        updatedCount,
        alreadyFixedCount,
        alreadyPendingCount,
        needsReinvestigationCount,
      },
      mismatches: results,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    log.info('OltReportImport', 'Import completed', {
      importId,
      stats: response.stats,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('OltReportImport', 'Import failed', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
