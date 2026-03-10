/**
 * GET /api/procurement/boq-spend-summary
 * Cross-project BOQ spend summary — shows spend vs BOQ value for all projects with active BOQs.
 * "Confirmed" = POs with status received/partially_received/invoiced/paid.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  const { projectId, dateFrom, dateTo } = req.query;
  const from = typeof dateFrom === 'string' ? dateFrom : null;
  const to = typeof dateTo === 'string' ? dateTo : null;

  // If projectId provided, return PO transactions for that project
  if (projectId && typeof projectId === 'string') {
    try {
      let rows;
      if (from && to) {
        rows = await sql`
          SELECT po.id, po.external_po_number, po.status, po.order_date, s.name as supplier_name,
            COALESCE(SUM(poi.total_price), 0)::numeric as total_amount, COUNT(poi.id) as item_count
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
          WHERE po.project_id::text = ${projectId}::text AND po.status NOT IN ('draft', 'cancelled')
            AND po.order_date >= ${from}::date AND po.order_date <= ${to}::date
          GROUP BY po.id, po.external_po_number, po.status, po.order_date, s.name
          ORDER BY po.order_date DESC NULLS LAST`;
      } else if (from) {
        rows = await sql`
          SELECT po.id, po.external_po_number, po.status, po.order_date, s.name as supplier_name,
            COALESCE(SUM(poi.total_price), 0)::numeric as total_amount, COUNT(poi.id) as item_count
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
          WHERE po.project_id::text = ${projectId}::text AND po.status NOT IN ('draft', 'cancelled')
            AND po.order_date >= ${from}::date
          GROUP BY po.id, po.external_po_number, po.status, po.order_date, s.name
          ORDER BY po.order_date DESC NULLS LAST`;
      } else if (to) {
        rows = await sql`
          SELECT po.id, po.external_po_number, po.status, po.order_date, s.name as supplier_name,
            COALESCE(SUM(poi.total_price), 0)::numeric as total_amount, COUNT(poi.id) as item_count
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
          WHERE po.project_id::text = ${projectId}::text AND po.status NOT IN ('draft', 'cancelled')
            AND po.order_date <= ${to}::date
          GROUP BY po.id, po.external_po_number, po.status, po.order_date, s.name
          ORDER BY po.order_date DESC NULLS LAST`;
      } else {
        rows = await sql`
          SELECT po.id, po.external_po_number, po.status, po.order_date, s.name as supplier_name,
            COALESCE(SUM(poi.total_price), 0)::numeric as total_amount, COUNT(poi.id) as item_count
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
          WHERE po.project_id::text = ${projectId}::text AND po.status NOT IN ('draft', 'cancelled')
          GROUP BY po.id, po.external_po_number, po.status, po.order_date, s.name
          ORDER BY po.order_date DESC NULLS LAST`;
      }

      const transactions = rows.map((r) => ({
        id: r.id,
        poNumber: r.external_po_number || '—',
        status: r.status,
        orderDate: r.order_date,
        supplierName: r.supplier_name || 'Unknown',
        totalAmount: Number(r.total_amount),
        itemCount: Number(r.item_count),
        confirmed: ['received', 'partially_received', 'closed'].includes(r.status),
      }));

      return apiResponse.success(res, { transactions });
    } catch (err) {
      log.error('Failed to load project PO transactions', { err, projectId }, 'boq-spend-summary');
      return apiResponse.serverError(res, err instanceof Error ? err.message : 'Unknown error');
    }
  }

  try {
    const projects = await sql`
      SELECT
        p.id as project_id,
        p.project_name,
        b.id as boq_id,
        b.version as boq_version,
        (SELECT COUNT(*) FROM boq_items WHERE boq_id = b.id) as boq_line_count,
        (SELECT COALESCE(SUM(unit_price * quantity), 0) FROM boq_items WHERE boq_id = b.id)::numeric as boq_value,
        (
          SELECT COALESCE(SUM(poi.total_price), 0)
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.project_id::text = p.id::text
            AND po.status NOT IN ('draft', 'cancelled')
        )::numeric as total_ordered,
        (
          SELECT COALESCE(SUM(poi.total_price), 0)
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.project_id::text = p.id::text
            AND po.status IN ('received', 'partially_received', 'closed')
        )::numeric as confirmed_spend,
        (
          SELECT COUNT(DISTINCT po.id)
          FROM purchase_orders po
          WHERE po.project_id::text = p.id::text
        ) as po_count
      FROM projects p
      JOIN boqs b ON b.project_id::text = p.id::text AND b.status = 'active'
      ORDER BY boq_value DESC
    `;

    const summary = projects.map((r) => {
      const boqValue = Number(r.boq_value);
      const totalOrdered = Number(r.total_ordered);
      const confirmedSpend = Number(r.confirmed_spend);

      return {
        projectId: r.project_id,
        projectName: r.project_name,
        boqId: r.boq_id,
        boqVersion: r.boq_version,
        boqLineCount: Number(r.boq_line_count),
        boqValue,
        totalOrdered,
        confirmedSpend,
        remainingBudget: Math.max(0, boqValue - totalOrdered),
        orderedPercent: boqValue > 0 ? Math.round((totalOrdered / boqValue) * 100) : 0,
        confirmedPercent: boqValue > 0 ? Math.round((confirmedSpend / boqValue) * 100) : 0,
        poCount: Number(r.po_count),
      };
    });

    const totals = {
      boqValue: summary.reduce((s, r) => s + r.boqValue, 0),
      totalOrdered: summary.reduce((s, r) => s + r.totalOrdered, 0),
      confirmedSpend: summary.reduce((s, r) => s + r.confirmedSpend, 0),
      remainingBudget: summary.reduce((s, r) => s + r.remainingBudget, 0),
    };

    return apiResponse.success(res, { projects: summary, totals });
  } catch (err) {
    log.error('Failed to load BOQ spend summary', { err }, 'boq-spend-summary');
    return apiResponse.serverError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}
