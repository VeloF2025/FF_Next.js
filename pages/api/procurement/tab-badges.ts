// WORKING: Procurement Tab Badge Counts API
// Returns real counts for tab badges in the procurement portal
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { projectId } = req.query;

    // Build project filter
    const projectFilter = projectId ? `AND project_id = '${projectId}'` : '';

    const [boqCount, rfqCount, quoteCount, poCount, stockAlerts] = await Promise.all([
      sql`SELECT COUNT(*)::int as count FROM boqs WHERE status IN ('draft', 'review') ${projectId ? sql`AND project_id = ${projectId as string}` : sql``}`,
      sql`SELECT COUNT(*)::int as count FROM rfqs WHERE status = 'open' ${projectId ? sql`AND project_id = ${projectId as string}` : sql``}`,
      sql`SELECT COUNT(*)::int as count FROM rfqs WHERE status = 'closed' ${projectId ? sql`AND project_id = ${projectId as string}` : sql``}`,
      sql`SELECT COUNT(*)::int as count FROM purchase_orders WHERE status = 'pending' ${projectId ? sql`AND project_id = ${projectId as string}` : sql``}`,
      sql`SELECT COUNT(*)::int as count FROM stock_items WHERE quantity <= min_stock_level AND min_stock_level > 0`,
    ]);

    const badges: Record<string, { count: number; type: string }> = {};

    const boq = boqCount[0]?.count || 0;
    if (boq > 0) badges.boq = { count: boq, type: 'info' };

    const rfq = rfqCount[0]?.count || 0;
    if (rfq > 0) badges.rfq = { count: rfq, type: 'warning' };

    const quotes = quoteCount[0]?.count || 0;
    if (quotes > 0) badges.quotes = { count: quotes, type: 'success' };

    const po = poCount[0]?.count || 0;
    if (po > 0) badges['purchase-orders'] = { count: po, type: 'warning' };

    const stock = stockAlerts[0]?.count || 0;
    if (stock > 0) badges.stock = { count: stock, type: 'error' };

    return apiResponse.success(res, badges);
  } catch (error) {
    log.error('Failed to fetch tab badges', { data: error }, 'procurement/tab-badges');
    return apiResponse.error(res, 'Failed to fetch tab badges');
  }
}

export default withAuth(handler);
