/**
 * Stock Pickings API
 * GET /api/procurement/field-stock/pickings - List pickings
 * POST /api/procurement/field-stock/pickings - Create picking
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleCreate(req, res);
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

interface PickingLine {
  stockItemId: string;
  plannedQuantity: number;
  serialIds?: string[];
  lotNumber?: string;
  notes?: string;
}

// WORKING: Create picking with lines
async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      pickingType, sourceLocationId, destinationLocationId,
      projectId, jobReference, jobType,
      contractorId, contractorName, teamName,
      technicianId, technicianName, scheduledDate,
      notes, lines,
    } = req.body;

    if (!sourceLocationId) {
      return apiResponse.validationError(res, { sourceLocationId: 'Source location is required' });
    }
    if (!destinationLocationId) {
      return apiResponse.validationError(res, { destinationLocationId: 'Destination location is required' });
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return apiResponse.validationError(res, { lines: 'At least one picking line is required' });
    }

    // Generate picking number
    const countResult = await sql`SELECT COUNT(*) as count FROM stock_pickings`;
    const count = countResult[0] ? Number(countResult[0].count || 0) : 0;
    const pickingNumber = `PCK-${String(count + 1).padStart(6, '0')}`;

    // Create picking header
    const pickingResult = await sql`
      INSERT INTO stock_pickings (
        picking_number, picking_type,
        source_location_id, destination_location_id,
        project_id, job_reference, job_type,
        contractor_id, contractor_name, team_name,
        technician_id, technician_name,
        scheduled_date, status, notes
      ) VALUES (
        ${pickingNumber}, ${pickingType || null},
        ${sourceLocationId}, ${destinationLocationId},
        ${projectId || null}, ${jobReference || null}, ${jobType || null},
        ${contractorId || null}, ${contractorName || null}, ${teamName || null},
        ${technicianId || null}, ${technicianName || null},
        ${scheduledDate || null}, 'draft', ${notes || null}
      )
      RETURNING *
    `;

    const pickingRecord = pickingResult[0];
    if (!pickingRecord) {
      return apiResponse.internalError(res, new Error('Failed to create picking'));
    }

    const pickingId = pickingRecord.id as string;

    // Insert lines
    for (const line of lines as PickingLine[]) {
      await sql`
        INSERT INTO stock_picking_lines (
          picking_id, stock_item_id, planned_quantity,
          serial_ids, lot_number, notes, status
        ) VALUES (
          ${pickingId}, ${line.stockItemId}, ${line.plannedQuantity},
          ${line.serialIds ? JSON.stringify(line.serialIds) : null},
          ${line.lotNumber || null}, ${line.notes || null}, 'pending'
        )
      `;
    }

    // Refetch with full joins and lines
    const result = await sql`
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
      WHERE p.id = ${pickingId}
    `;

    log.info('Stock picking created', { pickingNumber, pickingId, lineCount: lines.length }, 'field-stock');
    res.status(201);
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating picking', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
