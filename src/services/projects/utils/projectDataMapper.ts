/**
 * Project Data Mapper
 * Maps database records to Project type objects
 */

import type { Project } from '@/types/project.types';

/** Raw database row returned from Neon queries */
type ProjectDbRecord = Record<string, unknown>;

/**
 * Project data mapping utilities
 */
export class ProjectDataMapper {
  /**
   * Map database project record to Project type
   */
  static mapToProject(project: ProjectDbRecord): Project {
    return {
      id: project.id as string,
      name: project.name as string,
      code: (project.code ?? project.project_code) as string,
      description: project.description as string | undefined,
      projectType: (project.type ?? project.project_type ?? 'OTHER') as Project['projectType'],
      status: project.status as Project['status'],
      priority: project.priority as Project['priority'],
      clientId: project.client_id as string | undefined,
      clientName: project.client_name as string | undefined,
      startDate: project.start_date as Project['startDate'],
      endDate: project.end_date as Project['endDate'],
      budget: project.budget as number | undefined,
      plannedProgress: (project.progress as number) || 0,
      actualProgress: (project.progress as number) || 0,
      isActive: project.is_active !== false,
      createdAt: project.created_at as Project['createdAt'],
      createdBy: 'system',
      updatedAt: project.updated_at as Project['updatedAt'],
      // Additional fields
      location: project.location as string | undefined,
      projectManager: (project.project_manager_name ?? project.manager ?? project.project_manager) as string | undefined,
      risks: (project.risks as string[]) || [],
      milestones: (project.milestones as Project['milestones']) || []
    };
  }

  /**
   * Map multiple database records to Project array
   */
  static mapToProjects(projects: ProjectDbRecord[]): Project[] {
    return projects.map(project => this.mapToProject(project));
  }

  /**
   * Map Project to database insert/update data
   */
  static mapToDatabase(project: Partial<Project>): ProjectDbRecord {
    return {
      name: project.name,
      code: project.code,
      description: project.description,
      status: project.status,
      type: project.projectType,
      priority: project.priority,
      client_id: project.clientId,
      start_date: project.startDate,
      end_date: project.endDate,
      budget: project.budget,
      progress: project.actualProgress || project.plannedProgress,
      is_active: project.isActive,
      location: project.location,
      manager: project.projectManager,
      risks: project.risks,
      milestones: project.milestones
    };
  }

  /**
   * Extract summary data from project
   */
  static extractSummary(project: Project): {
    id: string;
    name: string;
    status: string;
    progress: number;
    budget: number | null;
  } {
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      progress: project.actualProgress || project.plannedProgress || 0,
      budget: project.budget ?? null
    };
  }

  /**
   * Check if project is overdue
   */
  static isOverdue(project: Project): boolean {
    if (!project.endDate) return false;
    
    const endDate = new Date(project.endDate.toString());
    const now = new Date();
    
    return endDate < now && project.status !== 'completed';
  }

  /**
   * Calculate project duration in days
   */
  static calculateDuration(project: Project): number | null {
    if (!project.startDate || !project.endDate) return null;
    
    const start = new Date(project.startDate.toString());
    const end = new Date(project.endDate.toString());
    
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * Calculate remaining days
   */
  static calculateRemainingDays(project: Project): number | null {
    if (!project.endDate) return null;
    
    const endDate = new Date(project.endDate.toString());
    const now = new Date();
    
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * Get project status color
   */
  static getStatusColor(status: string): string {
    const statusColors: Record<string, string> = {
      'PLANNING': '#6B7280',
      'ACTIVE': '#10B981',
      'IN_PROGRESS': '#D97706',
      'ON_HOLD': '#EF4444',
      'COMPLETED': '#8B5CF6',
      'CANCELLED': '#9CA3AF'
    };
    
    return statusColors[status] || '#6B7280';
  }

  /**
   * Get project priority color
   */
  static getPriorityColor(priority: string): string {
    const priorityColors: Record<string, string> = {
      'LOW': '#10B981',
      'MEDIUM': '#D97706',
      'HIGH': '#EF4444',
      'URGENT': '#DC2626'
    };
    
    return priorityColors[priority] || '#D97706';
  }

  /**
   * Format project budget for display
   */
  static formatBudget(budget: number | null): string {
    if (!budget) return 'No budget set';
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(budget);
  }

  /**
   * Validate project data
   */
  static validateProject(project: Partial<Project>): string[] {
    const errors: string[] = [];
    
    const projectName = project.name || project.project_name;
    if (!projectName || projectName.trim().length === 0) {
      errors.push('Project name is required');
    }
    
    const projectCode = project.code || project.project_code;
    if (!projectCode || projectCode.trim().length === 0) {
      errors.push('Project code is required');
    }
    
    if (project.startDate && project.endDate) {
      const start = new Date(project.startDate.toString());
      const end = new Date(project.endDate.toString());
      
      if (start > end) {
        errors.push('Start date must be before end date');
      }
    }
    
    if (project.budget !== null && project.budget !== undefined && project.budget < 0) {
      errors.push('Budget cannot be negative');
    }
    
    return errors;
  }
}