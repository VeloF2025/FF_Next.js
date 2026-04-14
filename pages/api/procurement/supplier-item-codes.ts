import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  switch (req.method) {
    case 'GET':
      return handleGet(authReq, res);
    case 'POST':
      return handlePost(authReq, res);
    case 'DELETE':
      return handleDelete(authReq, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'DELETE']);
  }
}

/** GET: List supplier item code mappings */
async function handleGet(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { supplierId, stockItemId, search } = req.query;

  try {
    let rows;

    if (supplierId) {
      rows = await sql`
        SELECT sic.*, si.item_code as stock_code, si.name as stock_name, si.category as stock_category
        FROM supplier_item_codes sic
        JOIN stock_items si ON si.id = sic.stock_item_id
        WHERE sic.supplier_id = ${Number(supplierId)}
          AND sic.is_active = true
        ORDER BY sic.supplier_item_code
      `;
    } else if (stockItemId) {
      rows = await sql`
        SELECT sic.*, si.item_code as stock_code, si.name as stock_name, si.category as stock_category
        FROM supplier_item_codes sic
        JOIN stock_items si ON si.id = sic.stock_item_id
        WHERE sic.stock_item_id = ${stockItemId}::uuid
          AND sic.is_active = true
        ORDER BY sic.supplier_item_code
      `;
    } else if (search) {
      rows = await sql`
        SELECT sic.*, si.item_code as stock_code, si.name as stock_name, si.category as stock_category
        FROM supplier_item_codes sic
        JOIN stock_items si ON si.id = sic.stock_item_id
        WHERE sic.is_active = true
          AND (
            LOWER(sic.supplier_item_code) LIKE ${'%' + String(search).toLowerCase() + '%'}
            OR LOWER(sic.supplier_item_name) LIKE ${'%' + String(search).toLowerCase() + '%'}
          )
        ORDER BY sic.supplier_item_code
        LIMIT 50
      `;
    } else {
      rows = await sql`
        SELECT sic.*, si.item_code as stock_code, si.name as stock_name, si.category as stock_category
        FROM supplier_item_codes sic
        JOIN stock_items si ON si.id = sic.stock_item_id
        WHERE sic.is_active = true
        ORDER BY sic.updated_at DESC
        LIMIT 100
      `;
    }

    return apiResponse.success(res, { mappings: rows, count: rows.length });
  } catch (error) {
    log.error('Failed to fetch supplier item codes', { error: error });
    return apiResponse.internalError(res, error);
  }
}

/** POST: Create or update a supplier item code mapping */
async function handlePost(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const {
    supplierId,
    supplierItemCode,
    supplierItemName,
    stockItemId,
    supplierPrice,
    leadTimeDays,
    isPreferred,
  } = req.body;

  if (!stockItemId || !supplierItemCode) {
    return apiResponse.badRequest(res, 'stockItemId and supplierItemCode are required');
  }

  const userName = req.user?.name || req.user?.email || 'Unknown';

  try {
    // Upsert: if mapping already exists for this supplier+code, update it
    const existing = await sql`
      SELECT id FROM supplier_item_codes
      WHERE LOWER(supplier_item_code) = LOWER(${supplierItemCode})
        AND (supplier_id = ${supplierId ? Number(supplierId) : null} OR supplier_id IS NULL)
    `;

    let result;
    if (existing.length > 0) {
      result = await sql`
        UPDATE supplier_item_codes
        SET stock_item_id = ${stockItemId}::uuid,
            supplier_item_name = COALESCE(${supplierItemName || null}, supplier_item_name),
            supplier_price = COALESCE(${supplierPrice != null ? Number(supplierPrice) : null}, supplier_price),
            lead_time_days = COALESCE(${leadTimeDays != null ? Number(leadTimeDays) : null}, lead_time_days),
            is_preferred = COALESCE(${isPreferred != null ? Boolean(isPreferred) : null}, is_preferred),
            is_active = true,
            updated_at = NOW(),
            created_by = ${userName}
        WHERE id = ${existing[0]!.id}::uuid
        RETURNING *
      `;
    } else {
      result = await sql`
        INSERT INTO supplier_item_codes (
          stock_item_id, supplier_id, supplier_item_code, supplier_item_name,
          supplier_price, lead_time_days, is_preferred, is_active, created_by
        ) VALUES (
          ${stockItemId}::uuid,
          ${supplierId ? Number(supplierId) : null},
          ${supplierItemCode},
          ${supplierItemName || null},
          ${supplierPrice != null ? Number(supplierPrice) : null},
          ${leadTimeDays != null ? Number(leadTimeDays) : null},
          ${isPreferred || false},
          true,
          ${userName}
        )
        RETURNING *
      `;
    }

    log.info('Supplier item code mapping saved', {
      supplierItemCode,
      stockItemId,
      isUpdate: existing.length > 0,
    });

    return apiResponse.success(res, {
      mapping: result[0],
      isUpdate: existing.length > 0,
    });
  } catch (error) {
    log.error('Failed to save supplier item code mapping', { error: error });
    return apiResponse.internalError(res, error);
  }
}

/** DELETE: Remove a mapping */
async function handleDelete(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id) {
    return apiResponse.badRequest(res, 'Mapping id is required');
  }

  try {
    await sql`
      UPDATE supplier_item_codes
      SET is_active = false, updated_at = NOW()
      WHERE id = ${String(id)}::uuid
    `;

    return apiResponse.success(res, { deleted: true });
  } catch (error) {
    log.error('Failed to delete supplier item code mapping', { error: error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
