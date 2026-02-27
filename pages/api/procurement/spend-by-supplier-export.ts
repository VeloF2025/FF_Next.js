/**
 * Spend by Supplier CSV Export
 * GET — export supplier spend analysis as CSV
 *
 * Query params: fromDate, toDate, projectId
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'supplier', label: 'Supplier' },
  { key: 'totalPOs', label: 'Total POs' },
  { key: 'totalValue', label: 'Total Value' },
  { key: 'pctSpend', label: '% of Spend' },
  { key: 'avgPOValue', label: 'Avg PO Value' },
  { key: 'lastOrderDate', label: 'Last Order Date' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { projectId } = req.query;
    let { fromDate, toDate } = req.query;

    // Default to SA fiscal year (March 1)
    if (!fromDate) {
      const now = new Date();
      const year = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
      fromDate = `${year}-03-01`;
    }
    if (!toDate) {
      toDate = new Date().toISOString().split('T')[0];
    }

    // Explicit branches for projectId
    const rows = projectId
      ? await sql`
          SELECT
            COALESCE(s.company_name, s.name) as supplier_name,
            COUNT(DISTINCT po.id)::int as total_pos,
            SUM(po.total_amount) as total_value,
            AVG(po.total_amount) as avg_po_value,
            MAX(po.order_date) as last_order_date
          FROM purchase_orders po
          JOIN suppliers s ON po.supplier_id = s.id
          WHERE po.status NOT IN ('cancelled', 'draft')
            AND po.order_date >= ${fromDate as string}
            AND po.order_date <= ${toDate as string}
            AND po.project_id = ${projectId as string}
          GROUP BY s.id, s.company_name, s.name
          ORDER BY SUM(po.total_amount) DESC
        `
      : await sql`
          SELECT
            COALESCE(s.company_name, s.name) as supplier_name,
            COUNT(DISTINCT po.id)::int as total_pos,
            SUM(po.total_amount) as total_value,
            AVG(po.total_amount) as avg_po_value,
            MAX(po.order_date) as last_order_date
          FROM purchase_orders po
          JOIN suppliers s ON po.supplier_id = s.id
          WHERE po.status NOT IN ('cancelled', 'draft')
            AND po.order_date >= ${fromDate as string}
            AND po.order_date <= ${toDate as string}
          GROUP BY s.id, s.company_name, s.name
          ORDER BY SUM(po.total_amount) DESC
        `;

    const grandTotal = rows.reduce((s, r) => s + Number(r.total_value), 0);
    const totalPOs = rows.reduce((s, r) => s + Number(r.total_pos), 0);

    const mapped = rows.map((r: Record<string, unknown>) => {
      const val = Number(r.total_value);
      return {
        supplier: r.supplier_name || '',
        totalPOs: Number(r.total_pos),
        totalValue: val.toFixed(2),
        pctSpend: grandTotal > 0 ? ((val / grandTotal) * 100).toFixed(1) : '0.0',
        avgPOValue: Number(r.avg_po_value).toFixed(2),
        lastOrderDate: r.last_order_date || '',
      };
    });

    const totalsRow = {
      supplier: 'TOTAL',
      totalPOs,
      totalValue: grandTotal.toFixed(2),
      pctSpend: '100.0',
      avgPOValue: totalPOs > 0 ? (grandTotal / totalPOs).toFixed(2) : '0.00',
      lastOrderDate: '',
    };

    const csv = buildCSV(columns, mapped, { totalsRow });
    const filename = `spend-by-supplier-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export spend by supplier', { error: err }, 'spend-export');
    return apiResponse.internalError(res, err, 'Failed to export supplier spend');
  }
}

export default withAuth(withErrorHandler(handler));
