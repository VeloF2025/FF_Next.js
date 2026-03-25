/**
 * Field Stock Items API
 * GET /api/procurement/field-stock/items - List active stock items with filters
 * POST /api/procurement/field-stock/items - Create a new stock item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const category = req.query.category as string | undefined;
      const trackingType = req.query.trackingType as string | undefined;
      const rawSearch = req.query.search as string | undefined;
      const search = rawSearch ? `%${rawSearch}%` : undefined;

      // Explicit query branches — no conditional SQL fragments
      let rows: Record<string, unknown>[];

      if (category && trackingType && search) {
        // Branch 1: category AND trackingType AND search
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND category = ${category}
            AND tracking_type = ${trackingType}
            AND (name ILIKE ${search} OR item_code ILIKE ${search})
          ORDER BY category, name
          LIMIT 100
        `;
      } else if (category && search) {
        // Branch 2: category AND search
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND category = ${category}
            AND (name ILIKE ${search} OR item_code ILIKE ${search})
          ORDER BY category, name
          LIMIT 100
        `;
      } else if (trackingType && search) {
        // Branch 3: trackingType AND search
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND tracking_type = ${trackingType}
            AND (name ILIKE ${search} OR item_code ILIKE ${search})
          ORDER BY category, name
          LIMIT 100
        `;
      } else if (category) {
        // Branch 4: category only
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND category = ${category}
          ORDER BY category, name
          LIMIT 100
        `;
      } else if (trackingType) {
        // Branch 5: trackingType only
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND tracking_type = ${trackingType}
          ORDER BY category, name
          LIMIT 100
        `;
      } else if (search) {
        // Branch 6: search only
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
            AND (name ILIKE ${search} OR item_code ILIKE ${search})
          ORDER BY category, name
          LIMIT 100
        `;
      } else {
        // Branch 7: no filters
        rows = await sql`
          SELECT
            id, item_code, name, description, category, tracking_type,
            uom, standard_cost, currency, min_stock_level, max_stock_level,
            reorder_quantity, is_returnable, is_active, qty_available,
            created_at, updated_at
          FROM stock_items
          WHERE is_active = true
          ORDER BY category, name
          LIMIT 100
        `;
      }

      return apiResponse.success(res, rows);
    }

    if (req.method === 'POST') {
      const {
        itemCode,
        name,
        description,
        category,
        trackingType,
        uom,
        standardCost,
        minStockLevel,
        maxStockLevel,
        reorderQuantity,
        isReturnable,
      } = req.body as {
        itemCode: string;
        name: string;
        description?: string;
        category: string;
        trackingType: string;
        uom?: string;
        standardCost?: number;
        minStockLevel?: number;
        maxStockLevel?: number;
        reorderQuantity?: number;
        isReturnable?: boolean;
      };

      // Validate required fields
      if (!itemCode || !name || !category) {
        return apiResponse.validationError(res, {
          error: 'Missing required fields: itemCode, name, category',
        });
      }

      const result = await sql`
        INSERT INTO stock_items (
          item_code,
          name,
          description,
          category,
          tracking_type,
          uom,
          standard_cost,
          currency,
          min_stock_level,
          max_stock_level,
          reorder_quantity,
          is_returnable,
          is_active
        ) VALUES (
          ${itemCode},
          ${name},
          ${description ?? null},
          ${category},
          ${trackingType},
          ${uom ?? 'each'},
          ${standardCost ?? null},
          'ZAR',
          ${minStockLevel ?? 0},
          ${maxStockLevel ?? null},
          ${reorderQuantity ?? null},
          ${isReturnable ?? false},
          true
        )
        RETURNING
          id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, min_stock_level, max_stock_level,
          reorder_quantity, is_returnable, is_active,
          created_at, updated_at
      `;

      log.info('Stock item created', { itemCode, name, category }, 'field-stock/items');
      return apiResponse.created(res, result[0]);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('Field stock items API error', { error }, 'field-stock/items');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
