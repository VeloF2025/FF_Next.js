import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

// Initialize Neon client
const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { period = 'monthly' } = req.query;

  try {
    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'daily':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'quarterly':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'yearly':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    // Get summary statistics for the period
    const [
      projectSummary,
      staffSummary,
      sowSummary,
      financialSummary
    ] = await Promise.all([
      // Project summary
      sql`
        SELECT 
          COUNT(*) as total_projects,
          COUNT(CASE WHEN created_at >= ${startDate} THEN 1 END) as new_projects,
          COUNT(CASE WHEN status = 'active' OR status = 'in_progress' THEN 1 END) as active_projects,
          COUNT(CASE WHEN status = 'completed' AND updated_at >= ${startDate} THEN 1 END) as recently_completed
        FROM projects
      `,
      
      // Staff summary
      sql`
        SELECT 
          COUNT(*) as total_staff,
          COUNT(CASE WHEN created_at >= ${startDate} THEN 1 END) as new_hires,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_staff
        FROM staff
      `,
      
      // SOW summary for the period
      sql`
        SELECT 
          (SELECT COUNT(*) FROM sow_poles WHERE created_at >= ${startDate}) as poles_this_period,
          (SELECT COUNT(*) FROM sow_drops WHERE created_at >= ${startDate}) as drops_this_period,
          (SELECT COALESCE(SUM(length), 0) FROM sow_fibre WHERE created_at >= ${startDate}) as fiber_this_period
      `,
      
      // Financial summary
      sql`
        SELECT 
          COALESCE(SUM(budget), 0) as total_budget,
          COALESCE(AVG(budget), 0) as average_budget
        FROM projects
        WHERE created_at >= ${startDate}
      `
    ]);

    const projectData: any = projectSummary[0] || {};
    const staffData: any = staffSummary[0] || {};
    const sowData: any = sowSummary[0] || {};
    const financialData: any = financialSummary[0] || {};

    const summary = {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      projects: {
        total: parseInt(projectData.total_projects) || 0,
        new: parseInt(projectData.new_projects) || 0,
        active: parseInt(projectData.active_projects) || 0,
        completed: parseInt(projectData.recently_completed) || 0
      },
      staff: {
        total: parseInt(staffData.total_staff) || 0,
        new: parseInt(staffData.new_hires) || 0,
        active: parseInt(staffData.active_staff) || 0
      },
      infrastructure: {
        poles: parseInt(sowData.poles_this_period) || 0,
        drops: parseInt(sowData.drops_this_period) || 0,
        fiber: parseInt(sowData.fiber_this_period) || 0
      },
      financial: {
        totalBudget: parseFloat(financialData.total_budget) || 0,
        averageBudget: parseFloat(financialData.average_budget) || 0
      },
      highlights: [
        {
          metric: 'New Projects',
          value: parseInt(projectData.new_projects) || 0,
          change: 'neutral'
        },
        {
          metric: 'Active Staff',
          value: parseInt(staffData.active_staff) || 0,
          change: 'neutral'
        },
        {
          metric: 'Infrastructure Deployed',
          value: (parseInt(sowData.poles_this_period) || 0) + (parseInt(sowData.drops_this_period) || 0),
          change: 'neutral'
        }
      ]
    };

    return res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    
    return res.status(200).json({
      success: true,
      data: {
        period,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        projects: { total: 0, new: 0, active: 0, completed: 0 },
        staff: { total: 0, new: 0, active: 0 },
        infrastructure: { poles: 0, drops: 0, fiber: 0 },
        financial: { totalBudget: 0, averageBudget: 0 },
        highlights: []
      }
    });
  }
}

export default withAuth(handler);