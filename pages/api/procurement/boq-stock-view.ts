/**
 * GET /api/procurement/boq-stock-view
 *
 * Aggregates BOQ items cross-referenced with stock items.
 * Returns per-item: name, category, BOQ rate, planned qty, ordered, delivered, SOH.
 *
 * Query params:
 *   projectIds  - optional, comma-separated project UUIDs
 *   categories  - optional, comma-separated category strings
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export interface BOQStockRow {
  itemCode: string | null;
  name: string;
  category: string;
  boqRate: number;
  uom: string;
  plannedQty: number;
  orderedQty: number;
  deliveredQty: number;
  soh: number;
}

export interface BOQStockViewResponse {
  data: BOQStockRow[];
  projects: { id: string; name: string }[];
  categories: string[];
}

export default withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const rawProjectIds = req.query.projectIds as string | undefined;
    const rawCategories = req.query.categories as string | undefined;

    const projectIds = rawProjectIds ? rawProjectIds.split(',').filter(Boolean) : null;
    const categories = rawCategories ? rawCategories.split(',').filter(Boolean) : null;

    // Fetch available projects for filter dropdown
    const projectRows = await sql`
      SELECT DISTINCT p.id::text, p.project_name AS name
      FROM projects p
      INNER JOIN boqs b ON b.project_id::text = p.id::text
      ORDER BY p.project_name
    `;

    // Main aggregation — 4 explicit branches (no conditional SQL fragments)
    let rows: Record<string, unknown>[];

    if (projectIds && projectIds.length > 0 && categories && categories.length > 0) {
      // Branch 1: projectIds AND categories
      rows = await sql`
        SELECT
          COALESCE(si.item_code, bi.item_code)                          AS item_code,
          COALESCE(si.name, bi.description)                             AS name,
          COALESCE(si.category, bi.category, 'Uncategorized')           AS category,
          MIN(bi.unit_price)                                             AS boq_rate,
          COALESCE(si.uom, bi.uom, 'units')                             AS uom,
          SUM(bi.quantity)                                               AS planned_qty,
          COALESCE(SUM(po_agg.ordered_qty), 0)                          AS ordered_qty,
          COALESCE(SUM(grn_agg.delivered_qty), 0)                       AS delivered_qty,
          COALESCE(MAX(si.qty_available), 0)                            AS soh
        FROM boq_items bi
        JOIN boqs b ON bi.boq_id = b.id
        LEFT JOIN stock_items si ON si.id = bi.stock_item_id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(poi.quantity_ordered) AS ordered_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled')
          GROUP BY poi.boq_item_id
        ) po_agg ON po_agg.boq_item_id = bi.id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(gri.quantity_accepted) AS delivered_qty
          FROM goods_receipt_items gri
          JOIN purchase_order_items poi ON gri.po_item_id = poi.id
          JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
          WHERE poi.boq_item_id IS NOT NULL AND grn.status = 'completed'
          GROUP BY poi.boq_item_id
        ) grn_agg ON grn_agg.boq_item_id = bi.id
        WHERE b.project_id = ANY(${projectIds}::uuid[])
          AND COALESCE(si.category, bi.category, 'Uncategorized') = ANY(${categories})
          AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
        GROUP BY
          COALESCE(si.item_code, bi.item_code),
          COALESCE(si.name, bi.description),
          COALESCE(si.category, bi.category, 'Uncategorized'),
          COALESCE(si.uom, bi.uom, 'units')
        ORDER BY COALESCE(si.category, bi.category, 'Uncategorized'), COALESCE(si.name, bi.description)
      `;
    } else if (projectIds && projectIds.length > 0) {
      // Branch 2: projectIds only
      rows = await sql`
        SELECT
          COALESCE(si.item_code, bi.item_code)                          AS item_code,
          COALESCE(si.name, bi.description)                             AS name,
          COALESCE(si.category, bi.category, 'Uncategorized')           AS category,
          MIN(bi.unit_price)                                             AS boq_rate,
          COALESCE(si.uom, bi.uom, 'units')                             AS uom,
          SUM(bi.quantity)                                               AS planned_qty,
          COALESCE(SUM(po_agg.ordered_qty), 0)                          AS ordered_qty,
          COALESCE(SUM(grn_agg.delivered_qty), 0)                       AS delivered_qty,
          COALESCE(MAX(si.qty_available), 0)                            AS soh
        FROM boq_items bi
        JOIN boqs b ON bi.boq_id = b.id
        LEFT JOIN stock_items si ON si.id = bi.stock_item_id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(poi.quantity_ordered) AS ordered_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled')
          GROUP BY poi.boq_item_id
        ) po_agg ON po_agg.boq_item_id = bi.id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(gri.quantity_accepted) AS delivered_qty
          FROM goods_receipt_items gri
          JOIN purchase_order_items poi ON gri.po_item_id = poi.id
          JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
          WHERE poi.boq_item_id IS NOT NULL AND grn.status = 'completed'
          GROUP BY poi.boq_item_id
        ) grn_agg ON grn_agg.boq_item_id = bi.id
        WHERE b.project_id = ANY(${projectIds}::uuid[])
          AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
        GROUP BY
          COALESCE(si.item_code, bi.item_code),
          COALESCE(si.name, bi.description),
          COALESCE(si.category, bi.category, 'Uncategorized'),
          COALESCE(si.uom, bi.uom, 'units')
        ORDER BY COALESCE(si.category, bi.category, 'Uncategorized'), COALESCE(si.name, bi.description)
      `;
    } else if (categories && categories.length > 0) {
      // Branch 3: categories only
      rows = await sql`
        SELECT
          COALESCE(si.item_code, bi.item_code)                          AS item_code,
          COALESCE(si.name, bi.description)                             AS name,
          COALESCE(si.category, bi.category, 'Uncategorized')           AS category,
          MIN(bi.unit_price)                                             AS boq_rate,
          COALESCE(si.uom, bi.uom, 'units')                             AS uom,
          SUM(bi.quantity)                                               AS planned_qty,
          COALESCE(SUM(po_agg.ordered_qty), 0)                          AS ordered_qty,
          COALESCE(SUM(grn_agg.delivered_qty), 0)                       AS delivered_qty,
          COALESCE(MAX(si.qty_available), 0)                            AS soh
        FROM boq_items bi
        JOIN boqs b ON bi.boq_id = b.id
        LEFT JOIN stock_items si ON si.id = bi.stock_item_id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(poi.quantity_ordered) AS ordered_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled')
          GROUP BY poi.boq_item_id
        ) po_agg ON po_agg.boq_item_id = bi.id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(gri.quantity_accepted) AS delivered_qty
          FROM goods_receipt_items gri
          JOIN purchase_order_items poi ON gri.po_item_id = poi.id
          JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
          WHERE poi.boq_item_id IS NOT NULL AND grn.status = 'completed'
          GROUP BY poi.boq_item_id
        ) grn_agg ON grn_agg.boq_item_id = bi.id
        WHERE COALESCE(si.category, bi.category, 'Uncategorized') = ANY(${categories})
          AND (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
        GROUP BY
          COALESCE(si.item_code, bi.item_code),
          COALESCE(si.name, bi.description),
          COALESCE(si.category, bi.category, 'Uncategorized'),
          COALESCE(si.uom, bi.uom, 'units')
        ORDER BY COALESCE(si.category, bi.category, 'Uncategorized'), COALESCE(si.name, bi.description)
      `;
    } else {
      // Branch 4: no filters — return all
      rows = await sql`
        SELECT
          COALESCE(si.item_code, bi.item_code)                          AS item_code,
          COALESCE(si.name, bi.description)                             AS name,
          COALESCE(si.category, bi.category, 'Uncategorized')           AS category,
          MIN(bi.unit_price)                                             AS boq_rate,
          COALESCE(si.uom, bi.uom, 'units')                             AS uom,
          SUM(bi.quantity)                                               AS planned_qty,
          COALESCE(SUM(po_agg.ordered_qty), 0)                          AS ordered_qty,
          COALESCE(SUM(grn_agg.delivered_qty), 0)                       AS delivered_qty,
          COALESCE(MAX(si.qty_available), 0)                            AS soh
        FROM boq_items bi
        JOIN boqs b ON bi.boq_id = b.id
        LEFT JOIN stock_items si ON si.id = bi.stock_item_id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(poi.quantity_ordered) AS ordered_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.boq_item_id IS NOT NULL AND po.status NOT IN ('cancelled')
          GROUP BY poi.boq_item_id
        ) po_agg ON po_agg.boq_item_id = bi.id
        LEFT JOIN (
          SELECT poi.boq_item_id, SUM(gri.quantity_accepted) AS delivered_qty
          FROM goods_receipt_items gri
          JOIN purchase_order_items poi ON gri.po_item_id = poi.id
          JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
          WHERE poi.boq_item_id IS NOT NULL AND grn.status = 'completed'
          GROUP BY poi.boq_item_id
        ) grn_agg ON grn_agg.boq_item_id = bi.id
        WHERE (bi.item_code IS NULL OR bi.item_code != 'TOTAL')
        GROUP BY
          COALESCE(si.item_code, bi.item_code),
          COALESCE(si.name, bi.description),
          COALESCE(si.category, bi.category, 'Uncategorized'),
          COALESCE(si.uom, bi.uom, 'units')
        ORDER BY COALESCE(si.category, bi.category, 'Uncategorized'), COALESCE(si.name, bi.description)
      `;
    }

    const data: BOQStockRow[] = rows.map((r) => ({
      itemCode: (r.item_code as string | null) ?? null,
      name: r.name as string,
      category: r.category as string,
      boqRate: Number(r.boq_rate) || 0,
      uom: r.uom as string,
      plannedQty: Number(r.planned_qty) || 0,
      orderedQty: Number(r.ordered_qty) || 0,
      deliveredQty: Number(r.delivered_qty) || 0,
      soh: Number(r.soh) || 0,
    }));

    // Extract unique categories from result set
    const categorySet = new Set<string>();
    rows.forEach((r) => categorySet.add(r.category as string));
    const allCategories = Array.from(categorySet).sort();

    log.info('BOQ stock view loaded', { rows: data.length }, 'boq-stock-view');

    const result: BOQStockViewResponse = {
      data,
      projects: projectRows.map((p) => ({ id: p.id as string, name: p.name as string })),
      categories: allCategories,
    };

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('BOQ stock view failed', { error: (error as Error).message }, 'boq-stock-view');
    return apiResponse.internalError(res, error);
  }
});
