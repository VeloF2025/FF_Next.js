/**
 * Projects Service
 * Handles all project-related operations via Neon API
 */

import { log } from '@/lib/logger';

export interface Project {
  id: string;
  name: string;
  code: string;
  description?: string;
  status: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';
  clientId?: string;
  clientName?: string;
  startDate?: Date;
  endDate?: Date;
  budget?: number;
  actualCost?: number;
  progress?: number;
  teamMembers?: string[];
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface ProjectFormData {
  name: string;
  code: string;
  description?: string;
  status?: string;
  clientId?: string;
  clientName?: string;
  startDate?: Date;
  endDate?: Date;
  budget?: number;
  teamMembers?: string[];
  tags?: string[];
}

class ProjectsService {
  private baseUrl = '/api/projects';

  async getAll(): Promise<Project[]> {
    try {
      const response = await fetch(this.baseUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      log.error('Error fetching projects:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async getById(id: string): Promise<Project | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to fetch project: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error fetching project by ID:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async create(projectData: ProjectFormData): Promise<Project> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectData),
      });
      if (!response.ok) {
        throw new Error(`Failed to create project: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error creating project:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async update(id: string, projectData: Partial<ProjectFormData>): Promise<Project> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectData),
      });
      if (!response.ok) {
        throw new Error(`Failed to update project: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error updating project:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete project: ${response.statusText}`);
      }
    } catch (error) {
      log.error('Error deleting project:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async getByClient(clientId: string): Promise<Project[]> {
    try {
      const response = await fetch(`${this.baseUrl}?clientId=${clientId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch projects by client: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      log.error('Error fetching projects by client:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async getStats(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/stats`);
      if (!response.ok) {
        throw new Error(`Failed to fetch project stats: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error fetching project stats:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }

  async search(query: string): Promise<Project[]> {
    try {
      const response = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(`Failed to search projects: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      log.error('Error searching projects:', { data: error } as any, 'ProjectsService');
      throw error;
    }
  }
}

export const projectsService = new ProjectsService();