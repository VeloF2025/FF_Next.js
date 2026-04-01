/**
 * Fleet Odometer Bulk Import API
 * POST /api/fleet/import/odometer
 * Accepts base64-encoded Excel/CSV with columns: Registration, Date, Odometer
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ImportRow { registration: string; date: string; odometer: number; source?: string }
interface ImportError { row: number; message: string }

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { fileData, fileName } = req.body;
  if (!fileData) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'fileData (base64) is required');
  }

  try {
    // Parse Excel/CSV
    const buffer = Buffer.from(fileData, 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Empty file');
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Empty file');

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    if (rawRows.length === 0) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No data rows found');

    const rows: ImportRow[] = [];
    const errors: ImportError[] = [];

    const vehicleRows = await sql`SELECT id, registration FROM fleet_vehicles WHERE status != 'retired'`;
    const vehicleMap = new Map(vehicleRows.map(v => [String(v.registration).toUpperCase().trim(), v.id]));

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i] as Record<string, unknown>;
      const rowNum = i + 2;

      const reg = String(raw['Registration'] || raw['registration'] || raw['Reg'] || raw['reg'] || raw['Vehicle'] || '').toUpperCase().trim();
      const dateVal = raw['Date'] || raw['date'] || raw['Transaction Date'] || '';
      const odoVal = raw['Odometer'] || raw['odometer'] || raw['Reading'] || raw['reading'] || raw['Odo'] || raw['KM'] || raw['km'] || 0;
      const source = String(raw['Source'] || raw['source'] || 'import').toLowerCase();

      if (!reg) { errors.push({ row: rowNum, message: 'Missing registration' }); continue; }
      if (!vehicleMap.has(reg)) { errors.push({ row: rowNum, message: `Vehicle ${reg} not found` }); continue; }

      let date: string;
      if (dateVal instanceof Date) {
        date = dateVal.toISOString().split('T')[0]!;
      } else {
        date = String(dateVal);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ row: rowNum, message: `Invalid date: ${date}` }); continue; }
      }

      const odometer = typeof odoVal === 'number' ? odoVal : parseInt(String(odoVal).replace(/[^\d]/g, ''));
      if (isNaN(odometer) || odometer <= 0) { errors.push({ row: rowNum, message: `Invalid odometer: ${odoVal}` }); continue; }

      rows.push({ registration: reg, date, odometer, source });
    }

    // Insert valid rows
    let imported = 0;
    for (const row of rows) {
      const vehicleId = vehicleMap.get(row.registration)!;

      // Get previous reading for this vehicle
      const prev = await sql`
        SELECT reading FROM fleet_odometer_history
        WHERE vehicle_id = ${vehicleId} AND recorded_at <= ${row.date}::date + INTERVAL '1 day'
        ORDER BY recorded_at DESC LIMIT 1
      ` as Array<{ reading: number }>;

      const prevReading = prev[0]?.reading ?? null;
      const kmSinceLast = prevReading !== null ? row.odometer - prevReading : null;

      await sql`
        INSERT INTO fleet_odometer_history (vehicle_id, reading, source, previous_reading, km_since_last, recorded_at)
        VALUES (${vehicleId}, ${row.odometer}, ${row.source || 'import'}, ${prevReading}, ${kmSinceLast}, ${row.date}::date)
      `;
      imported++;
    }

    log.info('Odometer bulk import completed', { fileName, imported, skipped: errors.length, total: rawRows.length });

    return apiResponse.success(res, { imported, skipped: errors.length, total: rawRows.length, errors });
  } catch (error) {
    log.error('Odometer bulk import failed', { error, fileName });
    return apiResponse.internalError(res, error);
  }
}));
