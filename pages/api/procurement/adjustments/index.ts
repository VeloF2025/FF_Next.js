/**
 * Stock Adjustments API
 * GET  /api/procurement/adjustments - List adjustment movements
 * POST /api/procurement/adjustments - Create a direct stock adjustment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface CreateAdjustmentInput {
  stock_item_id: string;
  location_id: string;
  adjustment_type: 'increase' | 'decrease';
  quantity: number;
  reason_code: string;
  notes?: string;
  performed_by?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { location_id, reason_code, date_from, date_to, limit } = req.query;
    const rowLimit = Math.min(parseInt(limit as string) || 50, 200);

    let query = `
      SELECT
        sm.id,
        sm.stock_item_id,
        sm.from_location_id,
        sm.to_location_id,
        sm.quantity,
        sm.reference,
        sm.notes,
        sm.performed_by,
        sm.performed_at,
        si.item_code,
        si.name as item_name,
        fl.name as from_location_name,
        tl.name as to_location_name
      FROM field_stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_item_id
      LEFT JOIN stock_locations fl ON fl.id = sm.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = sm.to_location_id
      WHERE sm.movement_type = 'adjustment'
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (location_id) {
      query += ` AND (sm.from_location_id = $${paramIndex} OR sm.to_location_id = $${paramIndex})`;
      params.push(location_id as string);
      paramIndex++;
    }

    if (reason_code) {
      query += ` AND sm.notes LIKE $${paramIndex}`;
      params.push(`%[${reason_code}]%`);
      paramIndex++;
    }

    if (date_from) {
      query += ` AND sm.performed_at >= $${paramIndex}`;
      params.push(date_from as string);
      paramIndex++;
    }

    if (date_to) {
      query += ` AND sm.performed_at <= $${paramIndex}`;
      params.push(date_to as string);
      paramIndex++;
    }

    query += ` ORDER BY sm.performed_at DESC LIMIT $${paramIndex}`;
    params.push(rowLimit);

    const movements = await sql.query(query, params);
    return apiResponse.success(res, movements);
  } catch (error) {
    log.error('Adjustments GET error', { error, module: 'procurement:adjustments' });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: CreateAdjustmentInput = req.body;

    // Validate required fields
    if (!data.stock_item_id) {
      return apiResponse.validationError(res, { stock_item_id: 'Stock item is required' });
    }
    if (!data.location_id) {
      return apiResponse.validationError(res, { location_id: 'Location is required' });
    }
    if (!data.adjustment_type || !['increase', 'decrease'].includes(data.adjustment_type)) {
      return apiResponse.validationError(res, { adjustment_type: 'Must be "increase" or "decrease"' });
    }
    if (!data.quantity || data.quantity <= 0) {
      return apiResponse.validationError(res, { quantity: 'Quantity must be greater than 0' });
    }
    if (!data.reason_code) {
      return apiResponse.validationError(res, { reason_code: 'Reason code is required' });
    }

    // Look up ADJUST virtual location
    const adjustLocResult = await sql`
      SELECT id FROM stock_locations WHERE code = 'ADJUST'
    `;
    if (adjustLocResult.length === 0) {
      return apiResponse.badRequest(res, 'ADJUST virtual location not found. Run stock location setup.');
    }
    const adjustLocationId = adjustLocResult[0]!.id as string;

    // Generate reference: ADJ-YYYYMM-seq
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seqResult = await sql`
      SELECT COUNT(*) as cnt FROM field_stock_movements
      WHERE movement_type = 'adjustment'
        AND performed_at >= date_trunc('month', NOW())
    `;
    const seq = parseInt(seqResult[0]!.cnt as string) + 1;
    const reference = `ADJ-${yearMonth}-${String(seq).padStart(4, '0')}`;

    // Determine from/to locations based on direction
    let fromLocationId: string;
    let toLocationId: string;

    if (data.adjustment_type === 'decrease') {
      fromLocationId = data.location_id;
      toLocationId = adjustLocationId;

      // Decrease stock at location
      await sql`
        UPDATE stock_quants
        SET
          quantity = quantity - ${data.quantity},
          last_movement_date = NOW(),
          updated_at = NOW()
        WHERE stock_item_id = ${data.stock_item_id}
          AND location_id = ${data.location_id}
      `;
    } else {
      fromLocationId = adjustLocationId;
      toLocationId = data.location_id;

      // Increase stock at location (UPSERT)
      await sql`
        INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
        VALUES (${data.stock_item_id}, ${data.location_id}, ${data.quantity}, NOW())
        ON CONFLICT (stock_item_id, location_id, lot_number)
        DO UPDATE SET
          quantity = stock_quants.quantity + ${data.quantity},
          last_movement_date = NOW(),
          updated_at = NOW()
      `;
    }

    // Insert field_stock_movements record
    const noteText = data.notes
      ? `[${data.reason_code}] ${data.notes}`
      : `[${data.reason_code}]`;

    const movement = await sql`
      INSERT INTO field_stock_movements (
        stock_item_id,
        movement_type,
        from_location_id,
        to_location_id,
        quantity,
        reference,
        notes,
        performed_by,
        performed_at
      ) VALUES (
        ${data.stock_item_id},
        'adjustment',
        ${fromLocationId},
        ${toLocationId},
        ${data.quantity},
        ${reference},
        ${noteText},
        ${data.performed_by || 'system'},
        NOW()
      )
      RETURNING *
    `;

    log.info('Stock adjustment created', {
      reference,
      itemId: data.stock_item_id,
      locationId: data.location_id,
      type: data.adjustment_type,
      quantity: data.quantity,
      reason: data.reason_code,
    }, 'procurement:adjustments');

    return apiResponse.success(res, movement[0]);
  } catch (error) {
    log.error('Adjustments POST error', { error, module: 'procurement:adjustments' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
