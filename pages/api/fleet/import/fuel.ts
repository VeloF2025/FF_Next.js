/**
 * Fleet Fuel Transaction Bulk Import API
 * POST /api/fleet/import/fuel
 * Accepts base64-encoded Excel/CSV with columns: Registration, Date, Amount, Litres, Station, Odometer
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

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
    const buffer = Buffer.from(fileData, 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Empty file');
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Empty file');

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    if (rawRows.length === 0) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No data rows found');

    const vehicleRows = await sql`SELECT id, registration FROM fleet_vehicles WHERE status != 'retired'`;
    const vehicleMap = new Map(vehicleRows.map(v => [String(v.registration).toUpperCase().trim(), v.id]));

    const errors: ImportError[] = [];
    let imported = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i] as Record<string, unknown>;
      const rowNum = i + 2;

      const reg = String(raw['Registration'] || raw['registration'] || raw['Reg'] || raw['Vehicle'] || '').toUpperCase().trim();
      const dateVal = raw['Date'] || raw['date'] || raw['Transaction Date'] || '';
      const amountVal = raw['Amount'] || raw['amount'] || raw['Amount (R)'] || raw['Cost'] || raw['cost'] || 0;
      const litresVal = raw['Litres'] || raw['litres'] || raw['Liters'] || raw['Volume'] || raw['volume'] || 0;
      const station = String(raw['Station'] || raw['station'] || raw['Station Name'] || '').trim();
      const odoVal = raw['Odometer'] || raw['odometer'] || raw['Odo'] || raw['KM'] || null;

      if (!reg) { errors.push({ row: rowNum, message: 'Missing registration' }); continue; }
      if (!vehicleMap.has(reg)) { errors.push({ row: rowNum, message: `Vehicle ${reg} not found` }); continue; }

      let date: string;
      if (dateVal instanceof Date) {
        date = dateVal.toISOString().split('T')[0]!;
      } else {
        date = String(dateVal);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ row: rowNum, message: `Invalid date: ${date}` }); continue; }
      }

      const amount = typeof amountVal === 'number' ? amountVal : parseFloat(String(amountVal).replace(/[^\d.]/g, ''));
      if (isNaN(amount) || amount <= 0) { errors.push({ row: rowNum, message: `Invalid amount: ${amountVal}` }); continue; }

      const litres = typeof litresVal === 'number' ? litresVal : parseFloat(String(litresVal).replace(/[^\d.]/g, ''));
      if (isNaN(litres) || litres <= 0) { errors.push({ row: rowNum, message: `Invalid litres: ${litresVal}` }); continue; }

      const pricePerLitre = litres > 0 ? Math.round((amount / litres) * 100) / 100 : null;
      const odometer = odoVal ? (typeof odoVal === 'number' ? odoVal : parseInt(String(odoVal).replace(/[^\d]/g, ''))) : null;
      const vehicleId = vehicleMap.get(reg)!;

      await sql`
        INSERT INTO fleet_fuel_transactions (
          vehicle_id, transaction_date, amount_rand, litres, price_per_litre,
          odometer_reading, station_name, source
        ) VALUES (
          ${vehicleId}, ${date}::date, ${amount}, ${litres}, ${pricePerLitre},
          ${odometer}, ${station || null}, 'import'
        )
      `;
      imported++;
    }

    log.info('Fuel bulk import completed', { fileName, imported, skipped: errors.length, total: rawRows.length });

    return apiResponse.success(res, { imported, skipped: errors.length, total: rawRows.length, errors });
  } catch (error) {
    log.error('Fuel bulk import failed', { error, fileName });
    return apiResponse.internalError(res, error);
  }
}));
