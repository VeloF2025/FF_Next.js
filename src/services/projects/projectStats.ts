/**
 * Project Statistics Service - Migrated to Neon PostgreSQL
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import {
  Project,
  ProjectSummary,
  ProjectStatus
} from '@/types/project.types';

// Get database connection
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = neon(DATABASE_URL);

/**
 * Get project statistics summary
 */
export async function getProjectSummary(): Promise<ProjectSummary> {
  try {
    // Get project statistics from Neon
    const statsResult = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = ${ProjectStatus.ACTIVE} THEN 1 END) as active,
        COUNT(CASE WHEN status = ${ProjectStatus.COMPLETED} THEN 1 END) as completed,
        COUNT(CASE WHEN status = ${ProjectStatus.ON_HOLD} THEN 1 END) as on_hold,
        COALESCE(SUM(budget), 0) as total_budget,
        COALESCE(SUM(actual_cost), 0) as total_spent,
        COALESCE(AVG(progress), 0) as average_progress
      FROM projects
    `;

    const stats = statsResult[0];

    return {
      total: parseInt(stats?.total || 0),
      active: parseInt(stats?.active || 0),
      completed: parseInt(stats?.completed || 0),
      onHold: parseInt(stats?.on_hold || 0),
      totalBudget: parseFloat(stats?.total_budget || 0),
      totalSpent: parseFloat(stats?.total_spent || 0),
      averageProgress: parseFloat(stats?.average_progress || 0)
    };
  } catch (error) {
    log.error('Error getting project summary:', { data: error }, 'projectStats');
    throw new Error('Failed to fetch project summary');
  }
}

/**
 * Get projects by status
 */
export async function getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
  try {
    const result = await sql`
      SELECT
        id,
        name,
        client_id as "clientId",
        status,
        start_date as "startDate",
        end_date as "endDate",
        budget,
        actual_cost as "actualCost",
        progress,
        description,
        project_manager as "projectManager",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM projects
      WHERE status = ${status}
      ORDER BY created_at DESC
    `;

    return result as Project[];
  } catch (error) {
    log.error('Error getting projects by status:', { data: error }, 'projectStats');
    throw new Error('Failed to fetch projects by status');
  }
}

/**
 * Get project count by type
 */
export async function getProjectCountByType(): Promise<Record<string, number>> {
  try {
    const result = await sql`
      SELECT
        COALESCE(type, 'other') as project_type,
        COUNT(*) as count
      FROM projects
      GROUP BY COALESCE(type, 'other')
    `;

    const counts: Record<string, number> = {};
    result.forEach(row => {
      counts[row.project_type] = parseInt(row.count);
    });

    return counts;
  } catch (error) {
    log.error('Error getting project counts by type:', { data: error }, 'projectStats');
    throw new Error('Failed to fetch project counts');
  }
}

/**
 * Get projects ending soon (within next 7 days)
 */
export async function getProjectsEndingSoon(): Promise<Project[]> {
  try {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = await sql`
      SELECT
        id,
        name,
        client_id as "clientId",
        status,
        start_date as "startDate",
        end_date as "endDate",
        budget,
        actual_cost as "actualCost",
        progress,
        description,
        project_manager as "projectManager",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM projects
      WHERE status = ${ProjectStatus.ACTIVE}
      AND end_date >= ${now.toISOString()}
      AND end_date <= ${weekFromNow.toISOString()}
      ORDER BY end_date ASC
    `;

    return result as Project[];
  } catch (error) {
    log.error('Error getting projects ending soon:', { data: error }, 'projectStats');
    throw new Error('Failed to fetch projects ending soon');
  }
}

/**
 * Calculate project health score
 */
export async function calculateProjectHealthScore(projectId: string): Promise<number> {
  try {
    const statsResult = await sql`
      SELECT
        p.progress,
        p.budget,
        p.actual_cost as actual_cost,
        p.end_date as end_date,
        COUNT(DISTINCT ph.id) as total_phases,
        COUNT(DISTINCT CASE WHEN ph.status = 'completed' THEN ph.id END) as completed_phases,
        COUNT(DISTINCT CASE WHEN ph.status = 'blocked' THEN ph.id END) as blocked_phases,
        COUNT(DISTINCT t.id) as total_tasks,
        COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_tasks,
        COUNT(DISTINCT CASE WHEN t.is_blocked = true THEN t.id END) as blocked_tasks
      FROM projects p
      LEFT JOIN project_phases ph ON ph.project_id = p.id
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.id = ${projectId}
      GROUP BY p.id, p.progress, p.budget, p.actual_cost, p.end_date
    `;

    const stats = statsResult[0];
    if (!stats) {
      return 50; // Default neutral score
    }

    let healthScore = 50; // Start with neutral score

    // Add points for progress
    if (stats.progress > 75) {
      healthScore += 20;
    } else if (stats.progress > 50) {
      healthScore += 10;
    } else if (stats.progress < 25) {
      healthScore -= 20;
    }

    // Check budget variance
    if (stats.actual_cost && stats.budget) {
      const variance = ((stats.actual_cost - stats.budget) / stats.budget) * 100;
      if (variance > 20) {
        healthScore -= 25;
      } else if (variance > 10) {
        healthScore -= 15;
      }
    }

    // Check deadline
    if (stats.end_date && new Date(stats.end_date) < new Date()) {
      healthScore -= 20;
    }

    // Deduct points for blocked phases/tasks
    if (stats.total_phases > 0) {
      const blockedPercent = (stats.blocked_phases / stats.total_phases) * 100;
      healthScore -= Math.min(blockedPercent * 0.5, 20);
    }

    if (stats.total_tasks > 0) {
      const blockedTaskPercent = (stats.blocked_tasks / stats.total_tasks) * 100;
      healthScore -= Math.min(blockedTaskPercent * 0.3, 15);
    }

    return Math.max(0, Math.min(100, healthScore));
  } catch (error) {
    log.error('Error calculating project health score:', { data: error }, 'projectStats');
    throw new Error('Failed to calculate project health score');
  }
}

/**
 * Calculate budget variance for all projects
 */
export async function calculateBudgetVariance(): Promise<{
  overBudget: number;
  underBudget: number;
  onBudget: number;
  totalVariance: number;
}> {
  try {
    const result = await sql`
      SELECT
        COUNT(CASE WHEN actual_cost > budget * 1.1 THEN 1 END) as over_budget,
        COUNT(CASE WHEN actual_cost < budget * 0.9 THEN 1 END) as under_budget,
        COUNT(CASE WHEN actual_cost BETWEEN budget * 0.9 AND budget * 1.1 THEN 1 END) as on_budget,
        COALESCE(SUM(actual_cost - budget), 0) as total_variance
      FROM projects
      WHERE budget > 0 AND actual_cost IS NOT NULL
    `;

    const stats = result[0];

    return {
      overBudget: parseInt(stats?.over_budget || 0),
      underBudget: parseInt(stats?.under_budget || 0),
      onBudget: parseInt(stats?.on_budget || 0),
      totalVariance: parseFloat(stats?.total_variance || 0)
    };
  } catch (error) {
    log.error('Error calculating budget variance:', { data: error }, 'projectStats');
    throw new Error('Failed to calculate budget variance');
  }
}