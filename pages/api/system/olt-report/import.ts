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
import { Pool } from '@neondatabase/serverless';
import * as XLSX from 'xlsx';
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface OltRecord {
  drNumber: string;
  oltSerial: string | null;
  matchStatus: string;
  wrongOneMapSerial: string | null;
  rowIndex: number;
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
  };
  mismatches: Array<{
    drNumber: string;
    oltSerial: string | null;
    wrongSerial: string | null;
    status: 'updated' | 'empty_serial' | 'not_found';
  }>;
}

async function parseExcelFile(filePath: string): Promise<OltRecord[]> {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

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
      });
    }
  }

  return records;
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

    // Parse Excel file
    log.info('OltReportImport', 'Parsing Excel file', { filename: file.originalFilename });
    const records = await parseExcelFile(file.filepath);

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    if (records.length === 0) {
      return apiResponse.badRequest(res, 'No valid records found in Excel file');
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

    // Process mismatches - insert ALL into olt_mismatch_records
    const results: ImportResult['mismatches'] = [];
    let emptySerialCount = 0;
    let notFoundCount = 0;
    let updatedCount = 0;

    for (const mismatch of mismatches) {
      // Determine initial status
      let fixStatus = 'pending';
      if (!mismatch.oltSerial) {
        fixStatus = 'empty_serial';
        emptySerialCount++;
      }

      // Insert into olt_mismatch_records (tracks ALL mismatches)
      await client.query(
        `INSERT INTO olt_mismatch_records
          (import_id, drop_number, olt_serial, wrong_onemap_serial, row_index, fix_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          importId,
          mismatch.drNumber,
          mismatch.oltSerial,
          mismatch.wrongOneMapSerial,
          mismatch.rowIndex,
          fixStatus,
        ]
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
      },
      mismatches: results,
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
