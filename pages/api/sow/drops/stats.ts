import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getSql();

  try {
    // Get overall statistics for all drops
    const statsQuery = await sql`
      SELECT
        COUNT(*) as total_drops,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_drops,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_drops,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_drops,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_drops,
        COALESCE(AVG(CASE WHEN status = 'completed' AND created_date IS NOT NULL AND updated_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (updated_at - created_date))/3600 END), 0) as avg_install_time,
        COALESCE(SUM(CASE WHEN cable_length IS NOT NULL THEN CAST(cable_length AS NUMERIC) ELSE 0 END), 0) as total_cable_used
      FROM sow_drops
    `;

    const stats = statsQuery[0];

    const completionRate = stats.total_drops > 0
      ? (stats.completed_drops / stats.total_drops) * 100
      : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalDrops: parseInt(stats.total_drops || '0'),
        completedDrops: parseInt(stats.completed_drops || '0'),
        pendingDrops: parseInt(stats.pending_drops || '0'),
        inProgressDrops: parseInt(stats.in_progress_drops || '0'),
        failedDrops: parseInt(stats.failed_drops || '0'),
        completionRate: Math.round(completionRate * 100) / 100,
        averageInstallTime: Math.round(parseFloat(stats.avg_install_time || '0') * 100) / 100,
        totalCableUsed: Math.round(parseFloat(stats.total_cable_used || '0') * 100) / 100,
      }
    });

  } catch (error) {
    console.error('Error fetching drops stats:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch drops stats'
    });
  }
}

export default withAuth(handler);
