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

      log.info('OESImport', `Importing ${oesRows.length} rows (batch mode)`, { reportDate });

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

      // Step 2: Batch upsert OES activations (in chunks of 500)
      const BATCH_SIZE = 500;
      let inserted = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < oesRows.length; i += BATCH_SIZE) {
        const chunk = oesRows.slice(i, i + BATCH_SIZE);

        // Build VALUES clause for batch insert
        const values: any[] = [];
        const placeholders: string[] = [];

        chunk.forEach((row, idx) => {
          const dropId = dropsMap.get(row.drop_number) || null;
          const offset = idx * 15;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`);
          values.push(
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
            batchId
          );
        });

        try {
          const result = await pool.query(
            `INSERT INTO oes_activations (
               drop_number, drop_id, serial_number, activation_date, olt_address,
               ont_rx_sig_dbm, link_budget_ont_olt_db, olt_rx_sig_dbm, link_budget_olt_ont_db,
               status, latitude, longitude, current_ont_rx, team, import_batch_id
             ) VALUES ${placeholders.join(', ')}
             ON CONFLICT (drop_number) DO UPDATE SET
               drop_id = COALESCE(EXCLUDED.drop_id, oes_activations.drop_id),
               serial_number = EXCLUDED.serial_number,
               activation_date = EXCLUDED.activation_date,
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

          // Estimate inserts vs updates (batch doesn't return per-row info easily)
          inserted += chunk.length;
        } catch (chunkError) {
          const errMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errMsg}`);
          log.error('OESImport', `Batch error at row ${i}`, chunkError);
        }

        log.info('OESImport', `Processed ${Math.min(i + BATCH_SIZE, oesRows.length)}/${oesRows.length}`);
      }

      // Step 3: Bulk update drops table to mark OES confirmed
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

      log.info('OESImport', 'Import complete', { inserted, updated, matched, unmatched, errors: errors.length });

      return res.status(200).json({
        success: true,
        totalRows: oesRows.length,
        inserted,
        updated: 0, // Batch mode doesn't track individual updates
        matched,
        unmatched,
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
