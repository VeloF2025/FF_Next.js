/**
 * POST /api/procurement/boq/rematch-stock
 * Re-run stock item matching on an existing BOQ
 * Body: { boqId: string }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { createStockMatcher } from '@/services/procurement/import/stockMatcher';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { boqId } = req.body;
  if (!boqId) {
    return apiResponse.badRequest(res, 'boqId is required');
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Clear existing stock matches for this BOQ
    await sql`
      UPDATE boq_items
      SET stock_item_id = NULL,
          stock_match_confidence = NULL,
          stock_match_method = NULL
      WHERE boq_id = ${boqId}::uuid
        AND (stock_match_method IS NULL OR stock_match_method != 'manual')
    `;

    // Load BOQ items
    const boqItemRows = await sql`
      SELECT id, item_code, description, category
      FROM boq_items
      WHERE boq_id = ${boqId}::uuid
        AND description IS NOT NULL AND description != ''
    `;

    if (boqItemRows.length === 0) {
      return apiResponse.success(res, { matched: 0, total: 0 });
    }

    const stockMatcher = createStockMatcher(process.env.DATABASE_URL!);
    const matchResults = await stockMatcher.matchBatch(
      boqItemRows.map(r => ({
        id: r.id as string,
        itemCode: (r.item_code as string) || null,
        description: r.description as string,
        category: (r.category as string) || null,
      }))
    );

    const stockItemsMatched = await stockMatcher.saveMatches(matchResults);

    log.info('Stock rematch complete', {
      boqId,
      total: boqItemRows.length,
      matched: stockItemsMatched,
    });

    return apiResponse.success(res, {
      matched: stockItemsMatched,
      total: boqItemRows.length,
      byMethod: {
        supplier_code: matchResults.filter(r => r.matchMethod === 'supplier_code').length,
        exact_code: matchResults.filter(r => r.matchMethod === 'exact_code').length,
        category_rule: matchResults.filter(r => r.matchMethod === 'category_rule').length,
        fuzzy_description: matchResults.filter(r => r.matchMethod === 'fuzzy_description').length,
        none: matchResults.filter(r => r.matchMethod === 'none').length,
      },
    });
  } catch (error) {
    log.error('Stock rematch failed', { error, boqId });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
