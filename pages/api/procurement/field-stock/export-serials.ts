/**
 * Bootstock Serial Export API
 * GET: Export filtered serials to Excel
 * Uses same filter logic as serial-recon but returns all rows as XLSX
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const project = (req.query.project as string) || '';
  const filter = (req.query.filter as string) || 'all';
  const type = (req.query.type as string) || 'ont';
  const search = (req.query.search as string) || '';

  const itemCode = type === 'ups' ? 'FT-GIZZU' : 'FT-ONT';
  const isOnt = type === 'ont';

  try {
    const rows = await getExportRows(itemCode, isOnt, project, filter, search);

    // Dynamic import xlsx
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const headers = isOnt
      ? ['Serial', 'Project', 'WA DR', 'OES Drop', 'PP Status', 'Activated', 'Status']
      : ['Serial', 'Project', 'WA DR', 'Status'];

    const data = rows.map((r: any) => {
      const base = [
        r.serial_number,
        r.location_name || '',
        r.wa_drop || '',
      ];
      if (isOnt) {
        base.push(
          r.oes_drop || '',
          r.pp_resolution_status || '',
          r.activation_date || '',
          r.wa_drop ? 'installed' : 'available',
        );
      } else {
        base.push(r.wa_drop ? 'installed' : 'available');
      }
      return base;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

    // Auto-width columns
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...data.map((r: string[]) => (r[i] || '').length));
      return { wch: Math.min(maxLen + 2, 30) };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, type === 'ups' ? 'UPS Serials' : 'ONT Serials');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filterLabel = filter === 'all' ? '' : `-${filter}`;
    const projectLabel = project ? `-${project}` : '';
    const filename = `bootstock-${type}${projectLabel}${filterLabel}-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    return res.send(buf);
  } catch (err) {
    log.error('[Serial-Export] Error', { error: err });
    return res.status(500).json({ error: 'Export failed' });
  }
}

async function getExportRows(itemCode: string, isOnt: boolean, project: string, filter: string, search: string) {
  // Search mode
  if (search) {
    const pattern = '%' + search.toUpperCase() + '%';
    if (isOnt) {
      return sql`
        SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status
        FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
        LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number))
        LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number))
        WHERE si.item_code = ${itemCode} AND UPPER(ss.serial_number) LIKE ${pattern}
        ORDER BY ss.serial_number
      `;
    }
    return sql`
      SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop
      FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id
      LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number))
      WHERE si.item_code = ${itemCode} AND UPPER(ss.serial_number) LIKE ${pattern}
      ORDER BY ss.serial_number
    `;
  }

  // Installed filter (ONT)
  if (filter === 'installed' && isOnt) {
    if (project) {
      return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} ORDER BY dr.drop_number`;
    }
    return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} ORDER BY dr.drop_number`;
  }

  // Installed filter (UPS)
  if (filter === 'installed' && !isOnt) {
    if (project) {
      return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} ORDER BY dr.drop_number`;
    }
    return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} ORDER BY dr.drop_number`;
  }

  // Not installed
  if (filter === 'not_installed') {
    const drField = isOnt ? 'dr.ont_serial_scanned' : 'dr.ups_serial_scanned';
    if (project) {
      return isOnt
        ? await sql`SELECT ss.serial_number, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL ORDER BY ss.serial_number`
        : await sql`SELECT ss.serial_number, sl.name as location_name, NULL::text as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} AND dr.id IS NULL ORDER BY ss.serial_number`;
    }
    return isOnt
      ? await sql`SELECT ss.serial_number, sl.name as location_name, NULL::text as wa_drop, NULL::text as oes_drop, NULL::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND dr.id IS NULL ORDER BY ss.serial_number`
      : await sql`SELECT ss.serial_number, sl.name as location_name, NULL::text as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND dr.id IS NULL ORDER BY ss.serial_number`;
  }

  // PP flagged
  if (filter === 'pp_flagged' && isOnt) {
    if (project) {
      return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE AND sl.name ILIKE ${'%' + project + '%'} ORDER BY ss.pp_resolution_status, ss.serial_number`;
    }
    return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND ss.pp_flagged = TRUE ORDER BY ss.pp_resolution_status, ss.serial_number`;
  }

  // Activated
  if (filter === 'activated' && isOnt) {
    if (project) {
      return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} ORDER BY oes.activation_date DESC`;
    }
    return sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} ORDER BY oes.activation_date DESC`;
  }

  // Default: all
  if (project) {
    return isOnt
      ? await sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} ORDER BY ss.serial_number`
      : await sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} AND sl.name ILIKE ${'%' + project + '%'} ORDER BY ss.serial_number`;
  }
  return isOnt
    ? await sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop, oes.drop_number as oes_drop, oes.activation_date::text as activation_date, ss.pp_resolution_status FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(ss.serial_number)) LEFT JOIN oes_activations oes ON UPPER(TRIM(oes.serial_number)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} ORDER BY ss.serial_number`
    : await sql`SELECT ss.serial_number, sl.name as location_name, dr.drop_number as wa_drop FROM stock_serials ss JOIN stock_items si ON ss.stock_item_id = si.id LEFT JOIN stock_locations sl ON ss.current_location_id = sl.id LEFT JOIN dr_photo_unified_reviews dr ON UPPER(TRIM(dr.ups_serial_scanned)) = UPPER(TRIM(ss.serial_number)) WHERE si.item_code = ${itemCode} ORDER BY ss.serial_number`;
}

export default withAuth(handler);
