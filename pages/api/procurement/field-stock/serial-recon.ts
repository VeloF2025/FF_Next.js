/**
 * Serial Reconciliation API
 * GET: Cross-reference stock_serials with WA DRs, OES activations
 *
 * Query params: type (ont|ups), project, filter (all|installed|not_installed|activated), search, page, limit
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
  const filter = (req.query.filter as string) || 'all';
  const search = (req.query.search as string) || '';
  const ppStatus = (req.query.ppStatus as string) || '';
  const type = (req.query.type as string) || 'ont';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;

  const itemCode = type === 'ups' ? 'FT-GIZZU' : 'FT-ONT';

  try {
    const stats = await getStats(itemCode, project);
    const waMatched = await getWaMatched(itemCode, type, project);
    const oesMatched = type === 'ont' ? await getOesMatched(project) : 0;
    const ppFlagged = type === 'ont' ? await getPpFlagged(project) : 0;
    const ppActivated = type === 'ont' ? await getPpActivated(project) : 0;
    const { rows, total } = await getDetailRows(itemCode, type, project, filter, search, ppStatus, limit, offset);

    return apiResponse.success(res, {
      stats: { ...stats, oesMatched, waMatched, ppFlagged, ppActivated },
      rows,
      page,
      limit,
      total,
    });
  } catch (err) {
    log.error('[Serial-Recon] Error', { error: err });
    return apiResponse.error(res, 'Reconciliation failed', 500);
  }
}

async function getStats(itemCode: string, project: string) {
  if (project) {
    const [row] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ss.status = 'available')::int as available,
        COUNT(*) FILTER (WHERE ss.status = 'issued')::int as issued,
        COUNT(*) FILTER (WHERE ss.status = 'installed')::int as installed,
        COUNT(*) FILTER (WHERE ss.status = 'faulty')::int as faulty,
        COUNT(*) FILTER (WHERE ss.status = 'returned')::int as returned
      FROM stock_serials ss
      JOIN stock_items si ON ss.stock_item_id = si.id
      JOIN stock_locations sl ON ss.current_location_id = sl.id
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
    `;
    return row;
  }
  const [row] = await sql`
    SELECT COUNT(*)::int as total,
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
  const joinField = type === 'ups' ? 'dr.ups_serial_scanned' : 'dr.ont_serial_scanned';
  if (project) {
    const [row] = type === 'ups'
      ? await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`
      : await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    return row?.c || 0;
  }
  const [row] = type === 'ups'
    ? await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode}`
    : await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode}`;
  return row?.c || 0;
}

async function getOesMatched(project: string) {
  if (project) {
    const [row] = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = 'FT-ONT' AND sl.name ILIKE ${'%' + project + '%'}`;
    return row?.c || 0;
  }
  const [row] = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = 'FT-ONT'`;
  return row?.c || 0;
}

/**
 * Detail rows with DR/OES cross-reference.
 * filter: all | installed (has WA DR) | not_installed (no WA DR) | activated (has OES)
 */
async function getDetailRows(
  itemCode: string, type: string, project: string, filter: string, search: string, ppStatusFilter: string, limit: number, offset: number
): Promise<{ rows: any[]; total: number }> {
  const drField = type === 'ups' ? 'dr.ups_serial_scanned' : 'dr.ont_serial_scanned';
  const isOnt = type === 'ont';

  // Build the base query with LEFT JOINs to WA DR and OES
  // We use separate queries per filter to avoid conditional SQL
  if (search) {
    // Search mode — find specific serial
    const searchPattern = '%' + search.toUpperCase() + '%';
    const rows = isOnt
      ? await sql`
          SELECT ss.serial_number, ss.status, sl.name as location_name,
            dr.drop_number as wa_drop, dr.ont_serial_scanned as wa_serial,
            oes.drop_number as oes_drop, oes.activation_date::text as activation_date
          FROM stock_serials ss
          JOIN stock_items si ON ss.stock_item_id = si.id
          LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
          LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
          LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
          WHERE si.item_code = ${itemCode} AND UPPER(ss.serial_number) LIKE ${searchPattern}
          ORDER BY ss.serial_number LIMIT ${limit}
        `
      : await sql`
          SELECT ss.serial_number, ss.status, sl.name as location_name,
            dr.drop_number as wa_drop, dr.ups_serial_scanned as wa_serial,
            NULL::text as oes_drop, NULL::text as activation_date
          FROM stock_serials ss
          JOIN stock_items si ON ss.stock_item_id = si.id
          LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
          LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
          WHERE si.item_code = ${itemCode} AND UPPER(ss.serial_number) LIKE ${searchPattern}
          ORDER BY ss.serial_number LIMIT ${limit}
        `;
    return { rows, total: rows.length };
  }

  if (filter === 'installed') {
    return isOnt ? getInstalledOnt(itemCode, project, limit, offset) : getInstalledUps(itemCode, project, limit, offset);
  }

  if (filter === 'pp_flagged' && isOnt) {
    return getPpFlaggedRows(itemCode, project, ppStatusFilter, limit, offset);
  }

  if (filter === 'not_installed') {
    // Show serials with NO WA DR match
    return isOnt ? getNotInstalledOnt(itemCode, project, limit, offset) : getNotInstalledUps(itemCode, project, limit, offset);
  }

  if (filter === 'activated' && isOnt) {
    return getActivatedOnt(itemCode, project, limit, offset);
  }

  // Default: all serials with their matches
  return getAllWithMatches(itemCode, type, project, limit, offset);
}

async function getInstalledOnt(itemCode: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
      ORDER BY dr.drop_number LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode}
    ORDER BY dr.drop_number LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode}`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getInstalledUps(itemCode: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
      ORDER BY dr.drop_number LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode}
    ORDER BY dr.drop_number LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode}`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getNotInstalledOnt(itemCode: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL
      ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode} AND dr.id IS NULL
    ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND dr.id IS NULL`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getNotInstalledUps(itemCode: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL
      ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode} AND dr.id IS NULL
    ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND dr.id IS NULL`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getActivatedOnt(itemCode: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
      LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
      ORDER BY oes.activation_date DESC LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
    LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode}
    ORDER BY oes.activation_date DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(DISTINCT ss.id)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode}`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getAllWithMatches(itemCode: string, type: string, project: string, limit: number, offset: number) {
  if (project) {
    const rows = type === 'ont'
      ? await sql`
          SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
          FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
          LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
          LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
          WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
          ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
          FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
          LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
          WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}
          ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
        `;
    const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'}`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = type === 'ont'
    ? await sql`
        SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_flagged, ss.pp_flagged_at::text as pp_date, ss.pp_resolution_status
        FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
        LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
        LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
        WHERE si.item_code = ${itemCode}
        ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
      `
    : await sql`
        SELECT ss.serial_number, ss.status, sl.name as location_name, dr.drop_number as wa_drop, NULL::text as oes_drop, NULL::text as activation_date
        FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
        LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
        WHERE si.item_code = ${itemCode}
        ORDER BY ss.serial_number LIMIT ${limit} OFFSET ${offset}
      `;
  const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = ${itemCode}`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

async function getPpFlagged(project: string) {
  if (project) {
    const [row] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = 'FT-ONT' AND ss.pp_flagged = TRUE AND sl.name ILIKE ${'%' + project + '%'}`;
    return row?.c || 0;
  }
  const [row] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = 'FT-ONT' AND ss.pp_flagged = TRUE`;
  return row?.c || 0;
}

async function getPpActivated(project: string) {
  if (project) {
    const [row] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = 'FT-ONT' AND ss.pp_flagged = TRUE AND ss.pp_resolution_status = 'activated' AND sl.name ILIKE ${'%' + project + '%'}`;
    return row?.c || 0;
  }
  const [row] = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = 'FT-ONT' AND ss.pp_flagged = TRUE AND ss.pp_resolution_status = 'activated'`;
  return row?.c || 0;
}

async function getPpFlaggedRows(itemCode: string, project: string, ppStatusFilter: string, limit: number, offset: number) {
  if (project) {
    const rows = await sql`
      SELECT ss.serial_number, ss.status, sl.name as location_name, ss.pp_resolution_status,
        dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE AND sl.name ILIKE ${'%' + project + '%'}
      ORDER BY ss.pp_resolution_status, ss.serial_number LIMIT ${limit} OFFSET ${offset}
    `;
    const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id JOIN stock_locations sl ON ss.current_location_id = sl.id WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE AND sl.name ILIKE ${'%' + project + '%'}`;
    const c = cRows[0]!;
    return { rows, total: c.c };
  }
  const rows = await sql`
    SELECT ss.serial_number, ss.status, sl.name as location_name, ss.pp_resolution_status,
      dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date
    FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
    LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
    LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
    WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE
    ORDER BY ss.pp_resolution_status, ss.serial_number LIMIT ${limit} OFFSET ${offset}
  `;
  const cRows = await sql`SELECT COUNT(*)::int as c FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE`;
  const c = cRows[0]!;
  return { rows, total: c.c };
}

export default withAuth(handler);
