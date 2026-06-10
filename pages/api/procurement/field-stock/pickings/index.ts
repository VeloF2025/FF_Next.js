/**
 * Stock Pickings API
 * GET /api/procurement/field-stock/pickings - List pickings
 * POST /api/procurement/field-stock/pickings - Create picking
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { sql as pgSql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { createPicking } from './_create';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleList(req, res);
  // withAuth wraps the default export, so req.user is guaranteed here.
  if (req.method === 'POST') return handleCreate(req as AuthenticatedNextApiRequest, res);
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

// WORKING: Explicit query branches — no conditional SQL fragments (Neon requirement)
async function handleList(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { pickingType, status, contractorId } = req.query;
    const pt = typeof pickingType === 'string' ? pickingType : null;
    const st = typeof status === 'string' ? status : null;
    const cid = typeof contractorId === 'string' ? contractorId : null;

    let result;

    if (pt && st) {
      result = await sql`
        SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
          sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
          (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
            'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
            'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
            'item_name',si.name,'item_code',si.item_code))
           FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
           WHERE pl.picking_id = p.id) as lines
        FROM stock_pickings p
        LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
        LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
        WHERE p.picking_type = ${pt} AND p.status = ${st}
        ORDER BY p.created_at DESC LIMIT 50`;
    } else if (pt) {
      result = await sql`
        SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
          sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
          (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
            'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
            'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
            'item_name',si.name,'item_code',si.item_code))
           FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
           WHERE pl.picking_id = p.id) as lines
        FROM stock_pickings p
        LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
        LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
        WHERE p.picking_type = ${pt}
        ORDER BY p.created_at DESC LIMIT 50`;
    } else if (st) {
      result = await sql`
        SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
          sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
          (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
            'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
            'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
            'item_name',si.name,'item_code',si.item_code))
           FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
           WHERE pl.picking_id = p.id) as lines
        FROM stock_pickings p
        LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
        LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
        WHERE p.status = ${st}
        ORDER BY p.created_at DESC LIMIT 50`;
    } else if (cid) {
      result = await sql`
        SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
          sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
          (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
            'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
            'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
            'item_name',si.name,'item_code',si.item_code))
           FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
           WHERE pl.picking_id = p.id) as lines
        FROM stock_pickings p
        LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
        LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
        WHERE p.contractor_id = ${cid}
        ORDER BY p.created_at DESC LIMIT 50`;
    } else {
      result = await sql`
        SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
          sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
          (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
            'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
            'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
            'item_name',si.name,'item_code',si.item_code))
           FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
           WHERE pl.picking_id = p.id) as lines
        FROM stock_pickings p
        LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
        LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
        ORDER BY p.created_at DESC LIMIT 50`;
    }

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error listing pickings', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

// Create picking with lines.
// Typed as AuthenticatedNextApiRequest so the compiler enforces that withAuth
// has populated req.user before this handler runs. Prevents a future refactor
// that bypasses withAuth from triggering a runtime TypeError on .user access
// (review-team L3).
//
// req.user → createdByStaffId resolution lives here; the rest of the create
// logic is in createPicking() (./_create) so the /my stores PWA route
// (withMySession, which carries staffId directly) can reuse it.
async function handleCreate(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  let createdByStaffId: string | null;
  try {
    // Resolve creator staff_id from the authenticated user. Nullable — admin /
    // system users without a staff row write NULL (matches the partial-index
    // predicate `WHERE created_by_staff_id IS NOT NULL` from migration 371).
    // Uses pg.Pool directly via @/lib/db-pool — new lookups should not extend
    // the Neon-shim surface even when surrounding code still uses it.
    const staffRows = await pgSql<{ id: string } & Record<string, unknown>>`
      SELECT id FROM staff WHERE user_id = ${req.user.id} LIMIT 1
    `;
    createdByStaffId = staffRows[0]?.id ?? null;
  } catch (error: unknown) {
    log.error('Error resolving creator staff for picking', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }

  return createPicking(req, res, createdByStaffId);
}

export default withAuth(handler);
