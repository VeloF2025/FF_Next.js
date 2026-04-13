import { ProjectQueryService } from './core/projectQueryService';
import { ProjectCRUDService } from './core/projectCRUDService';
import { ProjectAnalyticsService } from './analytics/projectAnalyticsService';
import type { Project, ProjectFormData, ProjectFilter } from '@/types/project.types';
import type { ProjectSummary } from './analytics/projectAnalyticsService';

/**
 * Project service using Neon PostgreSQL database
 */
export const projectNeonService = {
  /**
   * Get all projects with optional filtering
   */
  async getAll(filter?: ProjectFilter): Promise<Project[]> {
    return ProjectQueryService.getAllProjects(filter);
  },

  /**
   * Get a single project by ID
   */
  async getById(id: string): Promise<Project | null> {
    return ProjectQueryService.getProjectById(id);
  },

  /**
   * Create a new project
   */
  async create(data: ProjectFormData): Promise<string> {
    return ProjectCRUDService.createProject(data);
  },

  /**
   * Update an existing project
   */
  async update(id: string, data: Partial<ProjectFormData>): Promise<void> {
    return ProjectCRUDService.updateProject(id, data);
  },

  /**
   * Delete a project
   */
  async remove(id: string): Promise<void> {
    return ProjectCRUDService.deleteProject(id);
  },

  /**
   * Get project summary statistics
   */
  async getProjectSummary(): Promise<ProjectSummary> {
    return ProjectAnalyticsService.getProjectSummary();
  }
};