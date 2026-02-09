/**
 * API Route: /api/activate/import-pp-data
 *
 * Purpose: Import OES PP (Pre-Provision) data - ONT serials placed on network before activation
 * Methods:
 * - POST (multipart/form-data): Preview or import PP DATA from Excel
 * - GET ?action=list: Paginated list of PP data records
 * - GET ?action=stats: Summary statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { IncomingForm, Fields, Files } from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';

const logger = createLogger('PPDataImport');

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

// Project code mapping from Excel abbreviations to full names
const PROJECT_CODE_MAP: Record<string, string> = {
  'LAW': 'Lawley',
  'MOA': 'Mohadin',
  'MAM': 'Mamelodi',
};

interface PPRow {
  project: string;
  serial_number: string;
  date_registered: string | null;
}

/**
 * Parse Excel serial date to ISO date string
 */
function excelDateToISO(serial: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  const iso = date.toISOString();
  return iso.substring(0, iso.indexOf('T'));
}

/**
 * Parse the PP DATA sheet from an OES Excel workbook
 */
function parsePPDataExcel(filePath: string): { rows: PPRow[]; warnings: string[] } {
  const workbook = XLSX.readFile(filePath);
  const warnings: string[] = [];

  // Find sheet containing "PP" in name
  const ppSheetName = workbook.SheetNames.find(name =>
    name.toUpperCase().includes('PP')
  );

  if (!ppSheetName) {
    throw new Error(
      `No PP DATA sheet found. Available sheets: ${workbook.SheetNames.join(', ')}`
    );
  }

  // ppSheetName is guaranteed non-null by the check above
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sheet = workbook.Sheets[ppSheetName]!;
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  if (data.length < 2) {
    throw new Error('PP DATA sheet is empty or has no data rows');
  }

  // Validate headers (expecting: Project, Serial, Date Registered)
  const headers = data[0] as string[];
  if (headers.length < 2) {
    warnings.push(`Expected at least 2 columns (Project, Serial), got ${headers.length}`);
  }

  const rows: PPRow[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0] || !row[1]) continue;

    const rawProject = String(row[0]).trim().toUpperCase();
    const serialNumber = String(row[1]).trim();

    if (!serialNumber) continue;

    // Map project code to full name
    const project = PROJECT_CODE_MAP[rawProject] || rawProject;

    // Parse date
    let dateRegistered: string | null = null;
    if (row[2] !== undefined && row[2] !== null && row[2] !== '') {
      if (typeof row[2] === 'number') {
        dateRegistered = excelDateToISO(row[2]);
      } else {
        dateRegistered = String(row[2]).trim();
      }
    }

    rows.push({
      project,
      serial_number: serialNumber,
      date_registered: dateRegistered,
    });
  }

  logger.info(`Parsed ${rows.length} rows from sheet "${ppSheetName}"`);

  return { rows, warnings };
}

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
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

/**
 * Run local resolution against existing DB tables
 */
async function runLocalResolution(): Promise<{
  matched_oes: number;
  matched_unified: number;
  matched_onemap: number;
  total_resolved: number;
}> {
  const results = { matched_oes: 0, matched_unified: 0, matched_onemap: 0, total_resolved: 0 };

  // 1. Match against oes_activations.serial_number
  const oesResult = await pool.query(`
    UPDATE oes_pp_data pp
    SET resolution_status = 'matched_oes',
        resolved_drop_number = oa.drop_number,
        resolved_source = 'oes_activations',
        resolved_details = jsonb_build_object(
          'activation_date', oa.activation_date::text,
          'status', oa.status,
          'team', oa.team
        ),
        resolved_at = NOW(),
        updated_at = NOW()
    FROM oes_activations oa
    WHERE pp.serial_number = oa.serial_number
      AND pp.resolution_status = 'unresolved'
  `);
  results.matched_oes = oesResult.rowCount || 0;

  // 2. Match against dr_photo_unified_reviews (oes_serial or ont_serial_scanned)
  const unifiedResult = await pool.query(`
    UPDATE oes_pp_data pp
    SET resolution_status = 'matched_unified',
        resolved_drop_number = ur.drop_number,
        resolved_source = 'dr_photo_unified_reviews',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN ur.oes_serial = pp.serial_number THEN 'oes_serial'
            ELSE 'ont_serial_scanned'
          END,
          'project', ur.project
        ),
        resolved_at = NOW(),
        updated_at = NOW()
    FROM dr_photo_unified_reviews ur
    WHERE (ur.oes_serial = pp.serial_number OR ur.ont_serial_scanned = pp.serial_number)
      AND pp.resolution_status = 'unresolved'
  `);
  results.matched_unified = unifiedResult.rowCount || 0;

  // 3. Match against onemap_properties.ont_barcode
  try {
    const onemapResult = await pool.query(`
      UPDATE oes_pp_data pp
      SET resolution_status = 'matched_onemap',
          resolved_drop_number = op.drop_number,
          resolved_source = 'onemap_properties',
          resolved_details = jsonb_build_object(
            'site', op.site,
            'pole', op.pole
          ),
          resolved_at = NOW(),
          updated_at = NOW()
      FROM onemap_properties op
      WHERE op.ont_barcode = pp.serial_number
        AND pp.resolution_status = 'unresolved'
    `);
    results.matched_onemap = onemapResult.rowCount || 0;
  } catch (err) {
    logger.warn('onemap_properties lookup skipped', { error: String(err) });
  }

  results.total_resolved = results.matched_oes + results.matched_unified + results.matched_onemap;
  logger.info('Local resolution complete', results);
  return results;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const authReq = req as AuthenticatedNextApiRequest;

  // GET requests for list and stats
  if (req.method === 'GET') {
    const action = req.query.action as string;

    if (action === 'stats') {
      const statsResult = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE resolution_status != 'unresolved') as resolved,
          COUNT(*) FILTER (WHERE resolution_status = 'unresolved') as unresolved,
          COUNT(DISTINCT project) as projects
        FROM oes_pp_data
      `);

      const lastImportResult = await pool.query(`
        SELECT created_at, filename, total_rows
        FROM oes_pp_import_batches
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const stats = statsResult.rows[0];
      const lastImport = lastImportResult.rows[0] || null;

      return res.status(200).json({
        success: true,
        data: {
          total: parseInt(stats.total, 10),
          resolved: parseInt(stats.resolved, 10),
          unresolved: parseInt(stats.unresolved, 10),
          projects: parseInt(stats.projects, 10),
          lastImport: lastImport
            ? {
                date: lastImport.created_at,
                filename: lastImport.filename,
                totalRows: lastImport.total_rows,
              }
            : null,
        },
      });
    }

    if (action === 'list') {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = (page - 1) * limit;
      const project = req.query.project as string;
      const status = req.query.status as string;

      let whereClause = '';
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (project) {
        whereClause += ` AND project = $${paramIndex++}`;
        params.push(project);
      }
      if (status) {
        whereClause += ` AND resolution_status = $${paramIndex++}`;
        params.push(status);
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM oes_pp_data WHERE 1=1${whereClause}`,
        params
      );

      const dataResult = await pool.query(
        `SELECT * FROM oes_pp_data
         WHERE 1=1${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limit, offset]
      );

      return res.status(200).json({
        success: true,
        data: dataResult.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0].total, 10),
          totalPages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
        },
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "stats" or "list".' });
  }

  // POST for file upload (preview/import)
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

    logger.info(`Parsing file: ${uploadedFile.originalFilename}`);
    const { rows: ppRows, warnings } = parsePPDataExcel(filePath);

    fs.unlinkSync(filePath);

    if (action === 'preview') {
      return res.status(200).json({
        success: true,
        preview: ppRows,
        totalRows: ppRows.length,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }

    if (action === 'import') {
      logger.info(`Importing ${ppRows.length} PP data rows`);

      // Create import batch
      const batchResult = await pool.query(
        `INSERT INTO oes_pp_import_batches (filename, total_rows, imported_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [uploadedFile.originalFilename, ppRows.length, authReq.user?.email || 'system']
      );
      const batchId = batchResult.rows[0].id;

      // Batch upsert in chunks of 500
      const BATCH_SIZE = 500;
      let totalInserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < ppRows.length; i += BATCH_SIZE) {
        const chunk = ppRows.slice(i, i + BATCH_SIZE);

        const values: (string | number | null)[] = [];
        const placeholders: string[] = [];

        chunk.forEach((row, idx) => {
          const offset = idx * 4;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}::date, $${offset + 4})`
          );
          values.push(
            row.serial_number,
            row.project,
            row.date_registered,
            batchId
          );
        });

        try {
          const result = await pool.query(
            `INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
             VALUES ${placeholders.join(', ')}
             ON CONFLICT (serial_number, project) DO UPDATE SET
               date_registered = COALESCE(EXCLUDED.date_registered, oes_pp_data.date_registered),
               import_batch_id = EXCLUDED.import_batch_id,
               updated_at = NOW()
             WHERE oes_pp_data.resolution_status = 'unresolved'`,
            values
          );
          totalInserted += result.rowCount || 0;
        } catch (chunkError) {
          const errMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errMsg}`);
          logger.error(`Batch error at row ${i}`, { error: errMsg });
        }
      }

      // Run immediate local resolution
      const resolution = await runLocalResolution();

      // Update batch stats
      const finalStats = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE resolution_status != 'unresolved') as resolved,
          COUNT(*) FILTER (WHERE resolution_status = 'unresolved') as unresolved
        FROM oes_pp_data
        WHERE import_batch_id = $1
      `, [batchId]);

      const batchStats = finalStats.rows[0];
      await pool.query(
        `UPDATE oes_pp_import_batches
         SET resolved_count = $1, unresolved_count = $2
         WHERE id = $3`,
        [
          parseInt(batchStats.resolved, 10),
          parseInt(batchStats.unresolved, 10),
          batchId,
        ]
      );

      logger.info('Import complete', {
        totalRows: ppRows.length,
        upserted: totalInserted,
        resolution,
        errors: errors.length,
      });

      return res.status(200).json({
        success: true,
        totalRows: ppRows.length,
        upserted: totalInserted,
        resolution,
        errors,
        batchId,
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "preview" or "import".' });
  } catch (error) {
    logger.error('Import failed', { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
}

export default withAuth(withRole('manager')(handler));
