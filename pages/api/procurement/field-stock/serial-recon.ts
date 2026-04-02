/**
 * Serial Reconciliation API
 * GET: Cross-reference stock_serials with WA DRs, OES activations, PP data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || '');
  }

  const project = req.query.project as string | undefined;
  const status = req.query.status as string | undefined;
  const type = (req.query.type as string) || 'ont'; // 'ont' or 'ups'
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;

  const itemCode = type === 'ups' ? 'FT-GIZZU' : 'FT-ONT';

  try {
    // Summary stats
    const [stats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ss.status = 'available')::int as available,
        COUNT(*) FILTER (WHERE ss.status = 'issued')::int as issued,
        COUNT(*) FILTER (WHERE ss.status = 'installed')::int as installed,
        COUNT(*) FILTER (WHERE ss.status = 'faulty')::int as faulty,
        COUNT(*) FILTER (WHERE ss.status = 'returned')::int as returned
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      WHERE si.item_code = ${itemCode}
    `;

    // OES match count (ONT only)
    let oesMatched = 0;
    if (type === 'ont') {
      const [oesCount] = await sql`
        SELECT COUNT(DISTINCT ss.id)::int as c
        FROM stock_serials ss
        JOIN stock_items si ON ss.stock_item_id = si.id
        JOIN oes_activations oes ON UPPER(oes.serial_number) = UPPER(ss.serial_number)
        WHERE si.item_code = 'FT-ONT'
      `;
      oesMatched = oesCount?.c || 0;
    }

    // WA DR match count
    const serialField = type === 'ups' ? 'ups_serial_scanned' : 'ont_serial_scanned';
    const [waCount] = await sql`
      SELECT COUNT(DISTINCT ss.id)::int as c
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN dr_photo_unified_reviews dr ON UPPER(${type === 'ups' ? sql`dr.ups_serial_scanned` : sql`dr.ont_serial_scanned`}) = UPPER(ss.serial_number)
      WHERE si.item_code = ${itemCode}
    `;

    // Paginated detail rows
    const rows = await sql`
      SELECT
        ss.serial_number,
        ss.status,
        ss.installed_at_drop_number,
        ss.installed_date,
        sl.name as location_name,
        sl.code as location_code
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode}
        ${project ? sql`AND sl.name ILIKE ${'%' + project + '%'}` : sql``}
        ${status ? sql`AND ss.status = ${status}` : sql``}
      ORDER BY sl.name, ss.serial_number
      LIMIT ${limit} OFFSET ${offset}
    `;

    return apiResponse.success(res, {
      stats: {
        ...stats,
        oesMatched,
        waMatched: waCount?.c || 0,
      },
      rows,
      page,
      limit,
      total: stats.total,
    });
  } catch (err) {
    log.error('[Serial-Recon] Error', { error: err });
    return apiResponse.error(res, 'Reconciliation failed', 500);
  }
}

export default withAuth(handler);
