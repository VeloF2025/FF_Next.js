/**
 * API Route: /api/activate/import-pp-olt-data
 *
 * Purpose: Import OLT port data from "Velocity PPs" Excel export into oes_pp_data.
 * Updates ALL matching records regardless of resolution status.
 *
 * Excel format (any tab name, same schema):
 *   Project | Serial | Date Registered (SAST) | OLT Address | OLT Port
 *
 * OLT Port format: {olt}.olt.{nn}:R1.S1.LT{lt}.PON{pon}.ONT{ont}
 * OLT Address is derived from OLT Port when "Unknown": {olt}.olt.{nn}:1-1-{lt}-{pon}
 *
 * Method: POST (multipart/form-data), field name: "file"
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type Fields, type Files } from 'formidable';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/import-pp-olt-data');

export const config = { api: { bodyParser: false } };

interface OltComponents {
  olt_name: string;
  olt_lt: number;
  olt_pon: number;
  olt_ont_pos: number;
  olt_address: string;
  olt_port: string;
}

/** Parse OLT Port string into structured components and derive the compact address. */
function parseOltPort(portStr: string): OltComponents | null {
  const m = portStr.match(/^(\w+\.olt\.\d+):R\d+\.S\d+\.LT(\d+)\.PON(\d+)\.ONT(\d+)$/i);
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const oltName = m[1];
  const lt = m[2];
  const pon = m[3];
  const ont = m[4];
  return {
    olt_name: oltName,
    olt_lt: parseInt(lt, 10),
    olt_pon: parseInt(pon, 10),
    olt_ont_pos: parseInt(ont, 10),
    olt_address: `${oltName}:1-1-${lt}-${pon}`,
    olt_port: portStr,
  };
}

function parseForm(req: NextApiRequest): Promise<Files> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ keepExtensions: true, maxFileSize: 20 * 1024 * 1024 });
    form.parse(req, (err: Error | null, _fields: Fields, files: Files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

interface OltRow {
  serial: string;
  components: OltComponents;
}

function parseExcel(filePath: string): OltRow[] {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows: OltRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

    for (const row of raw) {
      // Support both "Serial" and "Serial Number" column names
      const serial = (row['Serial'] || row['Serial Number'] || '').toString().trim();
      const portStr = (row['OLT Port'] || '').toString().trim();
      if (!serial || !portStr) continue;

      const components = parseOltPort(portStr);
      if (!components) {
        logger.warn('Could not parse OLT Port', { serial, portStr });
        continue;
      }
      rows.push({ serial, components });
    }
  }

  return rows;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const files = await parseForm(req);
  const fileField = files['file'];
  const uploaded = Array.isArray(fileField) ? fileField[0] : fileField;
  if (!uploaded) {
    return apiResponse.error(res, 'MISSING_FILE' as never, 'No file uploaded');
  }

  let rows: OltRow[];
  try {
    rows = parseExcel(uploaded.filepath);
  } finally {
    fs.unlinkSync(uploaded.filepath);
  }

  if (rows.length === 0) {
    return apiResponse.error(res, 'NO_DATA' as never, 'No valid OLT rows found in file');
  }

  logger.info('OLT import: parsed rows', { count: rows.length });

  // Bulk update via unnest for efficiency
  const serials     = rows.map(r => r.serial);
  const ports       = rows.map(r => r.components.olt_port);
  const addresses   = rows.map(r => r.components.olt_address);
  const names       = rows.map(r => r.components.olt_name);
  const lts         = rows.map(r => r.components.olt_lt);
  const pons        = rows.map(r => r.components.olt_pon);
  const onts        = rows.map(r => r.components.olt_ont_pos);

  const result = await pool.query<{ updated_count: string }>(`
    WITH updates AS (
      SELECT
        unnest($1::text[])     AS serial,
        unnest($2::text[])     AS olt_port,
        unnest($3::text[])     AS olt_address,
        unnest($4::text[])     AS olt_name,
        unnest($5::smallint[]) AS olt_lt,
        unnest($6::smallint[]) AS olt_pon,
        unnest($7::smallint[]) AS olt_ont_pos
    )
    UPDATE oes_pp_data pp
    SET
      olt_port    = u.olt_port,
      olt_address = u.olt_address,
      olt_name    = u.olt_name,
      olt_lt      = u.olt_lt,
      olt_pon     = u.olt_pon,
      olt_ont_pos = u.olt_ont_pos,
      updated_at  = NOW()
    FROM updates u
    WHERE pp.serial_number = u.serial
    RETURNING pp.serial_number
  `, [serials, ports, addresses, names, lts, pons, onts]);

  const updatedCount = result.rowCount ?? 0;
  const notMatched = rows.length - updatedCount;

  logger.info('OLT import complete', { total: rows.length, updated: updatedCount, notMatched });

  return apiResponse.success(res, {
    total: rows.length,
    updated: updatedCount,
    notMatched,
  });
}

export default withAuth(withErrorHandler(withRole('manager')(handler)));
