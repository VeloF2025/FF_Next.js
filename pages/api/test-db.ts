// TEMPORARY: Test DB connection and tables
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Test 5: Try the actual quote-evaluations query
    const test5 = await sql`
      SELECT
        r.id as rfq_id,
        r.title as rfq_title,
        r.status as rfq_status,
        r.created_at,
        r.closing_date as deadline,
        r.project_id,
        COALESCE(qs.total_quotes, 0)::int as total_quotes,
        COALESCE(qs.lowest_bid, 0)::numeric as lowest_bid,
        COALESCE(qs.average_bid, 0)::numeric as average_bid,
        COALESCE(qs.highest_bid, 0)::numeric as highest_bid,
        CASE
          WHEN r.status = 'awarded' THEN 'AWARDED'
          WHEN r.status = 'closed' AND COALESCE(qs.total_quotes, 0) > 0 THEN 'COMPLETED'
          WHEN COALESCE(qs.total_quotes, 0) > 0 THEN 'IN_PROGRESS'
          ELSE 'PENDING'
        END as evaluation_status
      FROM rfqs r
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int as total_quotes,
          MIN(total_amount)::numeric as lowest_bid,
          AVG(total_amount)::numeric as average_bid,
          MAX(total_amount)::numeric as highest_bid
        FROM quotes q
        WHERE q.rfq_id = r.id
      ) qs ON true
      ORDER BY r.created_at DESC
      LIMIT 10
    `;

    return res.json({
      success: true,
      evaluations: test5
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
