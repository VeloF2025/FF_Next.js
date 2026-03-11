/**
 * Project Query Operations
 * All read/query operations for projects
 */

import { Project, ProjectFilter } from '@/types/project.types';
import { log } from '@/lib/logger';

const API_BASE = '/api';

export class ProjectQueryOperations {
  /**
   * Get all projects with optional filtering
   */
  static async getAllProjects(filter?: ProjectFilter): Promise<Project[]> {
    try {
      let url = `${API_BASE}/projects`;
      const params = new URLSearchParams();

      if (filter) {
        if (filter.status) {
          params.append('status', Array.isArray(filter.status) ? filter.status.join(',') : filter.status as string);
        }
        if (filter.clientId) {
          params.append('clientId', Array.isArray(filter.clientId) ? filter.clientId.join(',') : filter.clientId as string);
        }
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      log.error('Error fetching projects:', { error }, 'projectApi');
      throw error;
    }
  }

  /**
   * Get a single project by ID
   */
  static async getProjectById(id: string): Promise<Project | null> {
    try {
      const response = await fetch(`${API_BASE}/projects?id=${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch project: ${response.status}`);
      }

      const result = await response.json();
      return result.data || null;
    } catch (error) {
      log.error('Error fetching project by ID:', { error, id }, 'projectApi');
      throw error;
    }
  }

  /**
   * Get projects by client ID
   */
  static async getProjectsByClient(clientId: string): Promise<Project[]> {
    try {
      const response = await fetch(`${API_BASE}/projects?clientId=${clientId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch projects by client: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      log.error('Error fetching projects by client:', { error, clientId }, 'projectApi');
      return [];
    }
  }

  /**
   * Get projects by status
   */
  static async getProjectsByStatus(status: string): Promise<Project[]> {
    try {
      const response = await fetch(`${API_BASE}/projects?status=${status}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch projects by status: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      log.error('Error fetching projects by status:', { error, status }, 'projectApi');
      return [];
    }
  }

  /**
   * Search projects by name or code
   */
  static async searchProjects(searchTerm: string): Promise<Project[]> {
    try {
      const response = await fetch(`${API_BASE}/projects?search=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) {
        throw new Error(`Failed to search projects: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      log.error('Error searching projects:', { error, searchTerm }, 'projectApi');
      return [];
    }
  }

  /**
   * Get active projects only
   */
  static async getActiveProjects(): Promise<Project[]> {
    try {
      const response = await fetch(`${API_BASE}/projects`);
      if (!response.ok) {
        throw new Error(`Failed to fetch active projects: ${response.status}`);
      }

      const result = await response.json();
      const activeProjects = (result.data || [])
        .map((p: any) => ({
          ...p,
          id: p.id,
          name: p.project_name || p.name,
          code: p.project_code || p.code,
          clientId: p.client_id || p.clientId,
          clientName: p.client_name || p.clientName,
          projectType: p.project_type || p.projectType,
          startDate: p.start_date || p.startDate,
          endDate: p.end_date || p.endDate,
          projectManager: p.project_manager || p.projectManager,
          description: p.description,
          status: p.status
        }))
        .filter((project: any) => {
          const inactiveStatuses = ['completed', 'archived', 'cancelled', 'on_hold'];
          return !inactiveStatuses.includes(project.status?.toLowerCase() || '');
        });

      return activeProjects;
    } catch (error) {
      log.error('Error fetching active projects:', { error }, 'projectApi');
      return [];
    }
  }
}
