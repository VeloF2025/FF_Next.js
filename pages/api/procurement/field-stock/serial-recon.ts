/**
 * Serial Reconciliation API
 * GET: Cross-reference stock_serials with WA DRs, OES activations
 *
 * Query params: type (ont|ups), project, status, page, limit
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

  const project = (req.query.project as string) || '';
  const status = (req.query.status as string) || '';
  const type = (req.query.type as string) || 'ont';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;

  const itemCode = type === 'ups' ? 'FT-GIZZU' : 'FT-ONT';

  try {
    // Use explicit query branches — no conditional SQL fragments (Neon breaks with those)
    const stats = await getStats(itemCode, project);
    const waMatched = await getWaMatched(itemCode, type, project);
    const oesMatched = type === 'ont' ? await getOesMatched(project) : 0;
    const rows = await getRows(itemCode, project, status, limit, offset);
    const totalForPage = await getTotal(itemCode, project, status);

    return apiResponse.success(res, {
      stats: {
        ...stats,
        oesMatched,
        waMatched,
      },
      rows,
      page,
      limit,
      total: totalForPage,
    });
  } catch (err) {
    log.error('[Serial-Recon] Error', { error: err });
    return apiResponse.error(res, 'Reconciliation failed', 500);
  }
}

async function getStats(itemCode: string, project: string) {
  if (project) {
    const [row] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ss.status = 'available')::int as available,
        COUNT(*) FILTER (WHERE ss.status = 'issued')::int as issued,
        COUNT(*) FILTER (WHERE ss.status = 'installed')::int as installed,
        COUNT(*) FILTER (WHERE ss.status = 'faulty')::int as faulty,
        COUNT(*) FILTER (WHERE ss.status = 'returned')::int as returned
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode}
        AND sl.name ILIKE ${'%' + project + '%'}
    `;
    return row;
  }

  const [row] = await sql`
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
  return row;
}

async function getWaMatched(itemCode: string, type: string, project: string) {
  if (type === 'ups') {
    if (project) {
      const [row] = await sql`
        SELECT COUNT(DISTINCT ss.id)::int as c
        FROM stock_serials ss
        JOIN stock_items si ON ss.stock_item_id = si.id
        JOIN stock_locations sl ON ss.current_location_id = sl.id
        JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
        WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
      `;
      return row?.c || 0;
    }
    const [row] = await sql`
      SELECT COUNT(DISTINCT ss.id)::int as c
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode}
    `;
    return row?.c || 0;
  }

  // ONT
  if (project) {
    const [row] = await sql`
      SELECT COUNT(DISTINCT ss.id)::int as c
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN stock_locations sl ON ss.current_location_id = sl.id
      JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
    `;
    return row?.c || 0;
  }
  const [row] = await sql`
    SELECT COUNT(DISTINCT ss.id)::int as c
    FROM stock_serials ss
    JOIN stock_items si ON ss.stock_item_id = si.id
    JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode}
  `;
  return row?.c || 0;
}

async function getOesMatched(project: string) {
  if (project) {
    const [row] = await sql`
      SELECT COUNT(DISTINCT ss.id)::int as c
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN stock_locations sl ON ss.current_location_id = sl.id
      JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = 'FT-ONT' AND sl.name ILIKE ${'%' + project + '%'}
    `;
    return row?.c || 0;
  }
  const [row] = await sql`
    SELECT COUNT(DISTINCT ss.id)::int as c
    FROM stock_serials ss
    JOIN stock_items si ON ss.stock_item_id = si.id
    JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = 'FT-ONT'
  `;
  return row?.c || 0;
}

async function getRows(itemCode: string, project: string, status: string, limit: number, offset: number) {
  if (project && status) {
    return sql`
      SELECT ss.serial_number, ss.status, ss.installed_at_drop_number, ss.installed_date, sl.name as location_name, sl.code as location_code
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND ss.status = ${status}
      ORDER BY sl.name, ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
  }
  if (project) {
    return sql`
      SELECT ss.serial_number, ss.status, ss.installed_at_drop_number, ss.installed_date, sl.name as location_name, sl.code as location_code
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
      ORDER BY sl.name, ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
  }
  if (status) {
    return sql`
      SELECT ss.serial_number, ss.status, ss.installed_at_drop_number, ss.installed_date, sl.name as location_name, sl.code as location_code
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode} AND ss.status = ${status}
      ORDER BY sl.name, ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT ss.serial_number, ss.status, ss.installed_at_drop_number, ss.installed_date, sl.name as location_name, sl.code as location_code
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    WHERE si.item_code = ${itemCode}
    ORDER BY sl.name, ss.serial_number LIMIT ${limit} OFFSET ${offset}
  `;
}

async function getTotal(itemCode: string, project: string, status: string) {
  if (project && status) {
    const [r] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND ss.status = ${status}`;
    return r.c;
  }
  if (project) {
    const [r] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    return r.c;
  }
  if (status) {
    const [r] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = ${itemCode} AND ss.status = ${status}`;
    return r.c;
  }
  const [r] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = ${itemCode}`;
  return r.c;
}

export default withAuth(handler);
