/**
 * API Route: /api/activate/reporting/pending-aging
 *
 * Purpose: Get pending activation aging report (WA submitted but not in OES)
 * Method: GET
 *
 * Query Parameters:
 * - project (optional): Filter by project name
 *
 * Returns aging buckets and detailed records of stuck activations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface AgingBucket {
  bucket: string;
  count: number;
  min_days: number;
  max_days: number;
}

interface PendingRecord {
  drop_number: string;
  project: string;
  wa_submitted: string;
  days_pending: number;
  submitted_by: string | null;
  sender_phone: string | null;
  completed_photos: number;
}

interface PendingAgingResponse {
  summary: {
    total_pending: number;
    critical_30plus: number;
    warning_15_30: number;
    recent_0_7: number;
  };
  buckets: AgingBucket[];
  records: PendingRecord[];
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PendingAgingResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { project } = req.query;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('PendingAgingAPI', 'Fetching pending aging report', { project: projectStr });

    // Get aging buckets
    const bucketsResult = await sql`
      WITH wa_only AS (
        SELECT
          q.drop_number,
          q.project,
          q.created_at,
          CURRENT_DATE - q.created_at::date as days_pending
        FROM qa_photo_reviews q
        WHERE NOT EXISTS (
          SELECT 1 FROM oes_activations oes WHERE oes.drop_number = q.drop_number
        )
        ${projectStr ? sql`AND q.project = ${projectStr}` : sql``}
      )
      SELECT
        CASE
          WHEN days_pending <= 1 THEN '0-1 days'
          WHEN days_pending <= 3 THEN '2-3 days'
          WHEN days_pending <= 7 THEN '4-7 days'
          WHEN days_pending <= 14 THEN '8-14 days'
          WHEN days_pending <= 30 THEN '15-30 days'
          ELSE '30+ days'
        END as bucket,
        COUNT(DISTINCT drop_number) as count,
        MIN(days_pending) as min_days,
        MAX(days_pending) as max_days
      FROM wa_only
      GROUP BY 1
      ORDER BY MIN(days_pending)
    `;

    // Get detailed records (top 100 oldest)
    const recordsResult = await sql`
      WITH wa_only AS (
        SELECT
          q.drop_number,
          q.project,
          q.created_at::date as wa_submitted,
          CURRENT_DATE - q.created_at::date as days_pending,
          q.submitted_by,
          q.sender_phone,
          q.completed_photos
        FROM qa_photo_reviews q
        WHERE NOT EXISTS (
          SELECT 1 FROM oes_activations oes WHERE oes.drop_number = q.drop_number
        )
        ${projectStr ? sql`AND q.project = ${projectStr}` : sql``}
      )
      SELECT DISTINCT ON (drop_number)
        drop_number,
        project,
        wa_submitted,
        days_pending,
        submitted_by,
        sender_phone,
        completed_photos
      FROM wa_only
      ORDER BY drop_number, days_pending DESC
    `;

    // Sort by days_pending descending for display
    const sortedRecords = (recordsResult as PendingRecord[]).sort(
      (a, b) => b.days_pending - a.days_pending
    );

    // Calculate summary
    const buckets = bucketsResult as AgingBucket[];
    const summary = {
      total_pending: buckets.reduce((sum, b) => sum + Number(b.count), 0),
      critical_30plus: Number(buckets.find((b) => b.bucket === '30+ days')?.count || 0),
      warning_15_30: Number(buckets.find((b) => b.bucket === '15-30 days')?.count || 0),
      recent_0_7:
        Number(buckets.find((b) => b.bucket === '0-1 days')?.count || 0) +
        Number(buckets.find((b) => b.bucket === '2-3 days')?.count || 0) +
        Number(buckets.find((b) => b.bucket === '4-7 days')?.count || 0),
    };

    return res.status(200).json({
      summary,
      buckets: buckets.map((b) => ({
        ...b,
        count: Number(b.count),
        min_days: Number(b.min_days),
        max_days: Number(b.max_days),
      })),
      records: sortedRecords.slice(0, 100),
    });
  } catch (error) {
    log.error('PendingAgingAPI', 'Failed to fetch pending aging report', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(withRole('manager')(handler));
