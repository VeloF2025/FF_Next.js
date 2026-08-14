/**
 * GET /api/procurement/stock-snapshots
 *
 * Historical physical stock-take snapshots (table physical_stock_snapshots,
 * backfilled from Lizelle's weekly SharePoint workbook). Reference-only — this
 * endpoint never mutates stock levels.
 *
 * No params  -> { summary: [...] }  one row per (snapshot_date, source_tab)
 * ?date=YYYY-MM-DD[&source=<tab>]    -> { summary, rows: [...] } detail lines
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { query } from '@/lib/db-pool';

interface SummaryRow extends Record<string, unknown> {
  snapshot_date: string;
  source_tab: string;
  sites: number;
  lines: number;
  total_qty: number;
  total_value: number;
}

interface DetailRow extends Record<string, unknown> {
  item_code: string;
  item_name: string | null;
  category: string | null;
  site_label: string;
  warehouse_code: string | null;
  quantity: number;
  unit_cost: number | null;
  line_value: number | null;
  in_ff_catalog: boolean;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const summary = await query<SummaryRow>(
      `SELECT snapshot_date::text AS snapshot_date,
              source_tab,
              COUNT(DISTINCT site_label)::int          AS sites,
              COUNT(*)::int                            AS lines,
              ROUND(SUM(quantity))::int                AS total_qty,
              ROUND(SUM(COALESCE(line_value, 0)))::int AS total_value
         FROM physical_stock_snapshots
        GROUP BY snapshot_date, source_tab
        ORDER BY snapshot_date DESC, source_tab`
    );

    const { date, source } = req.query;
    if (typeof date === 'string' && date) {
      const params: unknown[] = [date];
      let where = 'snapshot_date = $1::date';
      if (typeof source === 'string' && source) {
        params.push(source);
        where += ' AND source_tab = $2';
      }
      const rows = await query<DetailRow>(
        `SELECT item_code, item_name, category, site_label, warehouse_code,
                quantity::float8 AS quantity,
                unit_cost::float8 AS unit_cost,
                line_value::float8 AS line_value,
                in_ff_catalog
           FROM physical_stock_snapshots
          WHERE ${where}
          ORDER BY category NULLS LAST, item_code, site_label`,
        params
      );
      return apiResponse.success(res, { summary, rows });
    }

    return apiResponse.success(res, { summary });
  } catch (err) {
    log.error('Failed to load stock snapshots', { err }, 'StockSnapshots');
    return apiResponse.internalError(res, err, 'Failed to load stock snapshots');
  }
}

export default withAuth(handler);
