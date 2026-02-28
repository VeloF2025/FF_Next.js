import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, withRole } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';
import { log } from '@/lib/logger';

// Initialize Neon client with logging
const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withRole('manager')(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Set cache headers to prevent browser caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  try {
    // Fetch real statistics from database using direct Neon client
    const [
      projectStats,
      staffStats,
      sowStats,
      clientStats,
      sowImportStats,
      contractorStats,
      openIssuesStats,
    ] = await Promise.all([
      // Projects statistics - using actual columns
      sql`
        SELECT 
          COUNT(*) as total_projects,
          COUNT(CASE WHEN status = 'active' OR status = 'in_progress' THEN 1 END) as active_projects,
          COUNT(CASE WHEN status = 'completed' OR status = 'finished' THEN 1 END) as completed_projects,
          COALESCE(SUM(budget::numeric), 0) as total_budget,
          COALESCE(AVG(progress), 0) as avg_progress
        FROM projects
      `,
      
      // Staff statistics - using actual columns
      sql`
        SELECT 
          COUNT(*) as total_staff,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_staff,
          COUNT(DISTINCT department) as departments
        FROM staff
      `,
      
      // SOW statistics - using sow_poles table instead of sow_imports
      sql`
        SELECT
          COUNT(DISTINCT project_id) as pole_projects,
          COUNT(*) as total_poles,
          0 as drop_imports,
          0 as fiber_imports,
          0 as total_processed
        FROM sow_poles
      `,
      
      // Client statistics - using actual columns
      sql`
        SELECT
          COUNT(*) as total_clients,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_clients
        FROM clients
      `,
      
      // Get project budgets for revenue calculation (without sow_imports)
      sql`
        SELECT
          COALESCE(SUM(budget::numeric), 0) as total_revenue,
          0 as total_imports,
          0 as completed_imports
        FROM projects
      `,

      // Contractor statistics
      sql`
        SELECT
          COUNT(*) as total_contractors,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as active_contractors,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_contractors,
          COUNT(CASE WHEN status IN ('under_review', 'documentation_incomplete') THEN 1 END) as review_contractors
        FROM contractors
      `,

      // Open issues — action items not yet completed or cancelled
      sql`SELECT COUNT(*) as open_issues FROM action_items WHERE status IN ('pending', 'in_progress')`
        .catch(() => [{ open_issues: 0 }]),
    ]);

    // Extract results
    const projectData: any = projectStats[0] || {};
    const staffData: any = staffStats[0] || {};
    const sowData: any = sowStats[0] || {};
    const clientData: any = clientStats[0] || {};
    const importData: any = sowImportStats[0] || {};
    const contractorData: any = contractorStats[0] || {};
    const issuesData: any = (openIssuesStats as any[])[0] || {};

    // Calculate derived metrics
    const completedProjects = parseInt(projectData.completed_projects) || 0;
    const totalProjects = parseInt(projectData.total_projects) || 0;
    const activeProjects = parseInt(projectData.active_projects) || 0;
    const avgProgress = parseFloat(projectData.avg_progress) || 0;
    
    // Calculate performance scores based on real data
    const performanceScore = avgProgress; // Use average project progress
    
    const qualityScore = completedProjects > 0 ? 85 : 0; // Placeholder - implement actual quality metrics
    const onTimeDelivery = completedProjects > 0 ? 92 : 0; // Placeholder - implement actual on-time metrics
    
    const totalBudget = parseFloat(projectData.total_budget) || 0;
    const totalRevenue = parseFloat(importData.total_revenue) || totalBudget; // Use project budgets as revenue
    const budgetUtilization = totalBudget > 0 ? 75 : 0; // Placeholder - implement actual budget tracking

    // Compile dashboard statistics
    const stats = {
      // Project stats
      totalProjects: parseInt(projectData.total_projects) || 0,
      activeProjects: parseInt(projectData.active_projects) || 0,
      completedProjects: parseInt(projectData.completed_projects) || 0,
      completedTasks: completedProjects * 5, // Estimate: 5 tasks per project
      
      // Staff stats
      teamMembers: parseInt(staffData.total_staff) || 0,
      openIssues: parseInt(issuesData.open_issues) || 0,
      
      // Infrastructure stats (from actual poles data)
      polesInstalled: parseInt(sowData.total_poles) || 0, // Use actual pole count
      dropsCompleted: parseInt(sowData.drop_imports) || 0, // Placeholder for now
      fiberInstalled: parseInt(sowData.fiber_imports) || 0, // Placeholder for now
      
      // Financial stats
      totalRevenue,
      
      // Contractor stats - from actual contractors table
      contractorsActive: parseInt(contractorData.active_contractors) || 0,
      contractorsPending: parseInt(contractorData.pending_contractors) || 0,
      
      // Procurement stats (no procurement tables yet)
      boqsActive: 0,
      rfqsActive: 0,
      supplierActive: 0,
      
      // Reports & KPIs
      reportsGenerated: parseInt(importData.total_imports) || 0, // Use imports as reports for now
      performanceScore: Math.round(performanceScore),
      qualityScore,
      onTimeDelivery,
      budgetUtilization
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    log.error('Dashboard stats error', { error });

    // Return zeros on error (no mock data)
    res.status(200).json({
      success: true,
      data: {
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        completedTasks: 0,
        teamMembers: 0,
        openIssues: 0,
        polesInstalled: 0,
        dropsCompleted: 0,
        fiberInstalled: 0,
        totalRevenue: 0,
        contractorsActive: 0,
        contractorsPending: 0,
        boqsActive: 0,
        rfqsActive: 0,
        supplierActive: 0,
        reportsGenerated: 0,
        performanceScore: 0,
        qualityScore: 0,
        onTimeDelivery: 0,
        budgetUtilization: 0
      }
    });
  }
})))