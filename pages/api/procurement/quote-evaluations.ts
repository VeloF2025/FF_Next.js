// WORKING: Quote Evaluations API
// Aggregates RFQ + quote data for the evaluation view
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
    const { status, search, projectId } = req.query;

    // Get RFQs that have received quotes, with quote statistics
    const evaluations = await sql`
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
          MIN(total_value)::numeric as lowest_bid,
          AVG(total_value)::numeric as average_bid,
          MAX(total_value)::numeric as highest_bid
        FROM quotes q
        WHERE q.rfq_id = r.id::text
      ) qs ON true
      WHERE 1=1
        ${status ? sql`AND (
          CASE
            WHEN r.status = 'awarded' THEN 'AWARDED'
            WHEN r.status = 'closed' AND COALESCE(qs.total_quotes, 0) > 0 THEN 'COMPLETED'
            WHEN COALESCE(qs.total_quotes, 0) > 0 THEN 'IN_PROGRESS'
            ELSE 'PENDING'
          END = ${status as string}
        )` : sql``}
        ${search ? sql`AND (r.title ILIKE ${'%' + (search as string) + '%'} OR r.id::text ILIKE ${'%' + (search as string) + '%'})` : sql``}
        ${projectId ? sql`AND r.project_id = ${projectId as string}` : sql``}
      ORDER BY r.created_at DESC
      LIMIT 100
    `;

    // Build stats
    const stats = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'open' AND NOT EXISTS (
          SELECT 1 FROM quotes q WHERE q.rfq_id = rfqs.id::text
        ))::int as pending,
        COUNT(*) FILTER (WHERE status = 'open' AND EXISTS (
          SELECT 1 FROM quotes q WHERE q.rfq_id = rfqs.id::text
        ))::int as in_progress,
        COUNT(*) FILTER (WHERE status = 'closed')::int as completed,
        COUNT(*) FILTER (WHERE status = 'awarded')::int as awarded,
        COALESCE(SUM((SELECT MIN(total_value) FROM quotes q WHERE q.rfq_id = rfqs.id::text)), 0)::numeric as total_value
      FROM rfqs
      ${projectId ? sql`WHERE project_id = ${projectId as string}` : sql``}
    `;

    const formattedEvaluations = evaluations.map((e: Record<string, unknown>) => ({
      id: e.rfq_id,
      rfqId: e.rfq_id,
      rfqTitle: e.rfq_title || 'Untitled RFQ',
      status: e.evaluation_status,
      totalQuotes: e.total_quotes,
      evaluatedQuotes: e.total_quotes, // All received quotes are "evaluated"
      lowestBid: Number(e.lowest_bid || 0),
      averageBid: Number(e.average_bid || 0),
      highestBid: Number(e.highest_bid || 0),
      currency: 'ZAR',
      deadline: e.deadline,
      createdDate: e.created_at,
      evaluatedBy: [],
    }));

    const statsData = stats[0] || {};

    return apiResponse.success(res, {
      evaluations: formattedEvaluations,
      stats: {
        total: statsData.total || 0,
        pending: statsData.pending || 0,
        inProgress: statsData.in_progress || 0,
        completed: statsData.completed || 0,
        awarded: statsData.awarded || 0,
        totalValue: Number(statsData.total_value || 0),
        averageEvaluationTime: 0, // Would need timeline tracking
      },
    });
  } catch (error) {
    log.error('Failed to fetch quote evaluations', { data: error }, 'procurement/quote-evaluations');
    return apiResponse.error(res, 'Failed to fetch quote evaluations');
  }
}

export default withAuth(handler);
