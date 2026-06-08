/**
 * GET /api/sitecam/submission/:drNumber
 *
 * Returns the PWA submission data for a DR, if any.
 * Used by the PwaComparisonTab in the Activate DR detail view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const { drNumber } = req.query;
  if (!drNumber || typeof drNumber !== 'string') return apiResponse.badRequest(res, 'drNumber required');

  const drNum = drNumber.replace(/^DR-/i, '');

  const { rows } = await pool.query(
    `SELECT r.pwa_submission_at,
            r.pwa_photo_count,
            r.pwa_photo_urls,
            r.ont_serial_scanned,
            r.ont_serial_status,
            r.ups_serial_scanned,
            r.ups_serial_status,
            r.vlm_power_meter_dbm,
            r.vlm_power_meter_status,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM dr_photo_unified_reviews r
     LEFT JOIN staff s ON s.id = r.pwa_tech_id
     WHERE r.drop_number = $1
       AND r.pwa_submission_at IS NOT NULL
     LIMIT 1`,
    [drNum]
  );

  if (!rows[0]) return apiResponse.success(res, { submission: null });

  const row = rows[0] as {
    pwa_submission_at: string;
    pwa_photo_count: number;
    pwa_photo_urls: Record<number, string> | null;
    ont_serial_scanned: string | null;
    ont_serial_status: string | null;
    ups_serial_scanned: string | null;
    ups_serial_status: string | null;
    vlm_power_meter_dbm: number | null;
    vlm_power_meter_status: string | null;
    tech_name: string | null;
  };

  return apiResponse.success(res, {
    submission: {
      submittedAt: row.pwa_submission_at,
      techName: row.tech_name ?? 'Unknown',
      photoCount: row.pwa_photo_count,
      photoUrls: row.pwa_photo_urls ?? {},
      ontSerialScanned: row.ont_serial_scanned ?? null,
      ontSerialStatus: row.ont_serial_status ?? null,
      upsSerialScanned: row.ups_serial_scanned ?? null,
      upsSerialStatus: row.ups_serial_status ?? null,
      powerMeterDbm: row.vlm_power_meter_dbm ?? null,
      powerMeterStatus: row.vlm_power_meter_status ?? null,
    },
  });
}

export default withAuth(handler);
