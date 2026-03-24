import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

// Initialize Neon client
const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { startDate, endDate, groupBy = 'monthly' } = req.query;

  try {
    // Calculate date ranges for comparison
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Get current period stats
    const [currentPeriod, previousPeriod] = await Promise.all([
      // Current 30 days
      sql`
        SELECT
          (SELECT COUNT(*) FROM projects WHERE created_at >= ${thirtyDaysAgo}) as new_projects,
          (SELECT COUNT(*) FROM staff WHERE created_at >= ${thirtyDaysAgo}) as new_staff,
          (SELECT COUNT(*) FROM sow_poles WHERE created_at >= ${thirtyDaysAgo}) as new_poles,
          (SELECT COUNT(*) FROM sow_drops WHERE created_at >= ${thirtyDaysAgo}) as new_drops,
          (SELECT COALESCE(COUNT(*), 0) FROM sow_poles WHERE created_at >= ${thirtyDaysAgo}) +
          (SELECT COALESCE(COUNT(*), 0) FROM sow_drops WHERE created_at >= ${thirtyDaysAgo}) as new_tasks
      `,
      
      // Previous 30 days
      sql`
        SELECT
          (SELECT COUNT(*) FROM projects WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) as prev_projects,
          (SELECT COUNT(*) FROM staff WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) as prev_staff,
          (SELECT COUNT(*) FROM sow_poles WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) as prev_poles,
          (SELECT COUNT(*) FROM sow_drops WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) as prev_drops,
          (SELECT COALESCE(COUNT(*), 0) FROM sow_poles WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) +
          (SELECT COALESCE(COUNT(*), 0) FROM sow_drops WHERE created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}) as prev_tasks
      `
    ]);

    const current: any = currentPeriod[0] || {};
    const previous: any = previousPeriod[0] || {};

    // Calculate trend percentages
    const calculateTrend = (currentVal: number, previousVal: number) => {
      if (previousVal === 0) {
        return {
          value: currentVal,
          direction: currentVal > 0 ? 'up' : 'stable' as 'up' | 'down' | 'stable',
          percentage: currentVal > 0 ? 100 : 0
        };
      }
      
      const percentageChange = ((currentVal - previousVal) / previousVal) * 100;
      return {
        value: currentVal,
        direction: percentageChange > 0 ? 'up' : percentageChange < 0 ? 'down' : 'stable' as 'up' | 'down' | 'stable',
        percentage: Math.abs(Math.round(percentageChange))
      };
    };

    const trends = {
      activeProjects: calculateTrend(
        parseInt(current.new_projects) || 0,
        parseInt(previous.prev_projects) || 0
      ),
      teamMembers: calculateTrend(
        parseInt(current.new_staff) || 0,
        parseInt(previous.prev_staff) || 0
      ),
      polesInstalled: calculateTrend(
        parseInt(current.new_poles) || 0,
        parseInt(previous.prev_poles) || 0
      ),
      dropsCompleted: calculateTrend(
        parseInt(current.new_drops) || 0,
        parseInt(previous.prev_drops) || 0
      ),
      completedTasks: calculateTrend(
        parseInt(current.new_tasks) || 0,
        parseInt(previous.prev_tasks) || 0
      ),
      openIssues: {
        value: 0,
        direction: 'stable' as const,
        percentage: 0
      }
    };

    return res.status(200).json({
      success: true,
      data: trends,
      projects: {
        trends
      },
      revenue: {
        trends: {}
      },
      staff: {
        trends
      }
    });
  } catch (error) {
    log.error('Dashboard trends error', { error });

    // Return stable trends on error
    const stableTrend = {
      value: 0,
      direction: 'stable' as const,
      percentage: 0
    };

    return res.status(200).json({
      success: true,
      data: {
        activeProjects: stableTrend,
        teamMembers: stableTrend,
        completedTasks: stableTrend,
        openIssues: stableTrend,
        polesInstalled: stableTrend,
        dropsCompleted: stableTrend
      },
      projects: { trends: {} },
      revenue: { trends: {} },
      staff: { trends: {} }
    });
  }
}

export default withAuth(withRole('manager')(handler));