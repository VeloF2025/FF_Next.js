/**
 * Stock Returns API
 * GET /api/procurement/field-stock/returns - List returns
 * POST /api/procurement/field-stock/returns - Create return
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleList(req, res);
  } else if (req.method === 'POST') {
    return handleCreate(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleList(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { status, returnedBy } = req.query;

    // Use separate queries based on filters to keep tagged template literals
    let result;

    if (status && typeof status === 'string' && returnedBy && typeof returnedBy === 'string') {
      result = await sql`
        SELECT
          r.*,
          sl.name as return_location_name,
          sl.code as return_location_code,
          (
            SELECT json_agg(
              json_build_object(
                'id', rl.id,
                'stock_item_id', rl.stock_item_id,
                'serial_id', rl.serial_id,
                'serial_number', rl.serial_number,
                'quantity', rl.quantity,
                'condition', rl.condition,
                'return_reason', rl.return_reason,
                'disposition', rl.disposition,
                'notes', rl.notes,
                'item_name', si.name,
                'item_code', si.item_code
              )
            )
            FROM stock_return_lines rl
            LEFT JOIN stock_items si ON si.id = rl.stock_item_id
            WHERE rl.return_id = r.id
          ) as lines
        FROM stock_returns r
        LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
        WHERE r.status = ${status} AND r.returned_by_id = ${returnedBy}
        ORDER BY r.created_at DESC
        LIMIT 50
      `;
    } else if (status && typeof status === 'string') {
      result = await sql`
        SELECT
          r.*,
          sl.name as return_location_name,
          sl.code as return_location_code,
          (
            SELECT json_agg(
              json_build_object(
                'id', rl.id,
                'stock_item_id', rl.stock_item_id,
                'serial_id', rl.serial_id,
                'serial_number', rl.serial_number,
                'quantity', rl.quantity,
                'condition', rl.condition,
                'return_reason', rl.return_reason,
                'disposition', rl.disposition,
                'notes', rl.notes,
                'item_name', si.name,
                'item_code', si.item_code
              )
            )
            FROM stock_return_lines rl
            LEFT JOIN stock_items si ON si.id = rl.stock_item_id
            WHERE rl.return_id = r.id
          ) as lines
        FROM stock_returns r
        LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
        WHERE r.status = ${status}
        ORDER BY r.created_at DESC
        LIMIT 50
      `;
    } else if (returnedBy && typeof returnedBy === 'string') {
      result = await sql`
        SELECT
          r.*,
          sl.name as return_location_name,
          sl.code as return_location_code,
          (
            SELECT json_agg(
              json_build_object(
                'id', rl.id,
                'stock_item_id', rl.stock_item_id,
                'serial_id', rl.serial_id,
                'serial_number', rl.serial_number,
                'quantity', rl.quantity,
                'condition', rl.condition,
                'return_reason', rl.return_reason,
                'disposition', rl.disposition,
                'notes', rl.notes,
                'item_name', si.name,
                'item_code', si.item_code
              )
            )
            FROM stock_return_lines rl
            LEFT JOIN stock_items si ON si.id = rl.stock_item_id
            WHERE rl.return_id = r.id
          ) as lines
        FROM stock_returns r
        LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
        WHERE r.returned_by_id = ${returnedBy}
        ORDER BY r.created_at DESC
        LIMIT 50
      `;
    } else {
      result = await sql`
        SELECT
          r.*,
          sl.name as return_location_name,
          sl.code as return_location_code,
          (
            SELECT json_agg(
              json_build_object(
                'id', rl.id,
                'stock_item_id', rl.stock_item_id,
                'serial_id', rl.serial_id,
                'serial_number', rl.serial_number,
                'quantity', rl.quantity,
                'condition', rl.condition,
                'return_reason', rl.return_reason,
                'disposition', rl.disposition,
                'notes', rl.notes,
                'item_name', si.name,
                'item_code', si.item_code
              )
            )
            FROM stock_return_lines rl
            LEFT JOIN stock_items si ON si.id = rl.stock_item_id
            WHERE rl.return_id = r.id
          ) as lines
        FROM stock_returns r
        LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
        ORDER BY r.created_at DESC
        LIMIT 50
      `;
    }

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error listing returns', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      originalPickingId,
      returnedById,
      returnedByName,
      returnToLocationId,
      lines,
      notes
    } = req.body;

    if (!returnToLocationId) {
      return apiResponse.validationError(res, { returnToLocationId: 'Return location is required' });
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return apiResponse.validationError(res, { lines: 'At least one return line is required' });
    }

    // Generate return number
    const countResult = await sql`SELECT COUNT(*) as count FROM stock_returns`;
    const countRecord = countResult[0];
    const count = countRecord ? Number(countRecord.count || 0) : 0;
    const returnNumber = `RET-${String(count + 1).padStart(6, '0')}`;

    // Create return header
    const returnResult = await sql`
      INSERT INTO stock_returns (
        return_number,
        original_picking_id,
        returned_by_id,
        returned_by_name,
        return_to_location_id,
        status,
        notes,
        return_date
      ) VALUES (
        ${returnNumber},
        ${originalPickingId || null},
        ${returnedById || null},
        ${returnedByName || null},
        ${returnToLocationId},
        'pending',
        ${notes || null},
        NOW()
      )
      RETURNING *
    `;

    const returnRecord = returnResult[0];
    if (!returnRecord) {
      return apiResponse.internalError(res, new Error('Failed to create return'));
    }

    const returnId = returnRecord.id as string;

    // Create return lines
    for (const line of lines) {
      await sql`
        INSERT INTO stock_return_lines (
          return_id,
          stock_item_id,
          serial_id,
          serial_number,
          quantity,
          condition,
          return_reason,
          notes
        ) VALUES (
          ${returnId},
          ${line.stockItemId},
          ${line.serialId || null},
          ${line.serialNumber || null},
          ${line.quantity || 1},
          ${line.condition || 'good'},
          ${line.returnReason || 'unused'},
          ${line.notes || null}
        )
      `;
    }

    // Fetch complete return with lines
    const result = await sql`
      SELECT
        r.*,
        (
          SELECT json_agg(
            json_build_object(
              'id', rl.id,
              'stock_item_id', rl.stock_item_id,
              'serial_id', rl.serial_id,
              'serial_number', rl.serial_number,
              'quantity', rl.quantity,
              'condition', rl.condition,
              'return_reason', rl.return_reason,
              'notes', rl.notes
            )
          )
          FROM stock_return_lines rl
          WHERE rl.return_id = r.id
        ) as lines
      FROM stock_returns r
      WHERE r.id = ${returnId}
    `;

    log.info('Stock return created', { returnNumber, returnId, lineCount: lines.length }, 'field-stock');
    res.status(201);
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating return', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
