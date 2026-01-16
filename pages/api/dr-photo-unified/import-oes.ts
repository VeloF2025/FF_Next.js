/**
 * API Route: /api/dr-photo-unified/import-oes
 *
 * Purpose: Import Nokia OES activation reports
 * Method: POST (multipart/form-data)
 *
 * Actions:
 * - preview: Parse Excel and return preview data
 * - import: Parse Excel, insert into oes_activations, update drops.oes_confirmed
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

interface OESRow {
  drop_number: string;
  serial_number: string;
  activation_date: string;
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
 * Parse Excel serial date to ISO date string
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
 * Parse Excel file and extract OES data
 */
function parseOESExcel(filePath: string): OESRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Use first sheet (OLT DATA)
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // Skip header row
  const rows: OESRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue; // Skip empty rows

    const dropNumber = String(row[0] || '').trim();
    if (!dropNumber.startsWith('DR')) continue; // Skip invalid rows

    rows.push({
      drop_number: dropNumber,
      serial_number: String(row[1] || '').trim(),
      activation_date: typeof row[2] === 'number' ? excelDateToISO(row[2]) : String(row[2] || ''),
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

  return rows;
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

export default async function handler(
  req: NextApiRequest,
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

    // Parse the Excel file
    log.info('OESImport', `Parsing file: ${uploadedFile.originalFilename}`);
    const oesRows = parseOESExcel(filePath);

    // Clean up temp file
    fs.unlinkSync(filePath);

    if (action === 'preview') {
      // Return preview data
      return res.status(200).json({
        success: true,
        preview: oesRows,
        totalRows: oesRows.length,
      });
    }

    if (action === 'import') {
      const reportDate = Array.isArray(fields.reportDate) ? fields.reportDate[0] : fields.reportDate;

      log.info('OESImport', `Importing ${oesRows.length} rows`, { reportDate });

      // Create import batch
      const batchResult = await pool.query(
        `INSERT INTO oes_import_batches (filename, report_date, total_rows)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [uploadedFile.originalFilename, reportDate || new Date().toISOString().split('T')[0], oesRows.length]
      );
      const batchId = batchResult.rows[0].id;

      let matched = 0;
      let unmatched = 0;
      let alreadyImported = 0;
      const errors: string[] = [];

      // Process each row
      for (const row of oesRows) {
        try {
          // Check if already imported
          const existingResult = await pool.query(
            `SELECT id FROM oes_activations WHERE drop_number = $1 AND activation_date = $2`,
            [row.drop_number, row.activation_date]
          );

          if (existingResult.rows.length > 0) {
            alreadyImported++;
            continue;
          }

          // Try to find matching drop
          const dropResult = await pool.query(
            `SELECT id FROM drops WHERE drop_number = $1`,
            [row.drop_number]
          );

          const dropId = dropResult.rows.length > 0 ? dropResult.rows[0].id : null;

          if (dropId) {
            matched++;

            // Mark drop as OES confirmed
            await pool.query(
              `UPDATE drops
               SET oes_confirmed = true, oes_confirmed_at = NOW()
               WHERE id = $1`,
              [dropId]
            );
          } else {
            unmatched++;
          }

          // Insert OES activation record
          await pool.query(
            `INSERT INTO oes_activations (
               drop_number, drop_id, serial_number, activation_date, olt_address,
               ont_rx_sig_dbm, link_budget_ont_olt_db, olt_rx_sig_dbm, link_budget_olt_ont_db,
               status, latitude, longitude, current_ont_rx, team, import_batch_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              row.drop_number,
              dropId,
              row.serial_number,
              row.activation_date,
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
              batchId,
            ]
          );
        } catch (rowError) {
          const errMsg = rowError instanceof Error ? rowError.message : 'Unknown error';
          errors.push(`${row.drop_number}: ${errMsg}`);
        }
      }

      // Update batch stats
      await pool.query(
        `UPDATE oes_import_batches
         SET matched_drops = $1, unmatched_drops = $2
         WHERE id = $3`,
        [matched, unmatched, batchId]
      );

      log.info('OESImport', 'Import complete', { matched, unmatched, alreadyImported, errors: errors.length });

      return res.status(200).json({
        success: true,
        totalRows: oesRows.length,
        matched,
        unmatched,
        alreadyImported,
        errors,
        batchId,
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
