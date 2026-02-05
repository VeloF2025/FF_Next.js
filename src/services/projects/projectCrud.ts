/**
 * Project CRUD Service - CLIENT-SIDE ONLY
 * Handles Create, Read, Update, Delete operations for projects via API routes.
 *
 * IMPORTANT: This module is designed for client-side use only.
 * For server-side operations, use projectNeonService directly.
 */

import { projectApiService } from '../project/projectApiService';
import type { Project, ProjectFormData, ProjectFilter } from '@/types/project.types';
import { ProjectStatus } from '@/types/project.types';

/**
 * Get all projects with optional filtering
 */
export async function getAll(filter?: ProjectFilter): Promise<Project[]> {
  const projects = await projectApiService.getAll();
  if (!filter) return projects;

  return projects.filter(project => {
    if (filter.status && !filter.status.includes(project.status as ProjectStatus)) return false;
    if (filter.clientId && !filter.clientId.includes(project.client_id || '')) return false;
    if (filter.projectType && !filter.projectType.includes(project.project_type || '')) return false;
    return true;
  });
}

/**
 * Get a single project by ID
 */
export async function getById(id: string): Promise<Project | null> {
  return projectApiService.getById(id);
}

/**
 * Create a new project
 */
export async function create(data: ProjectFormData): Promise<string> {
  const project = await projectApiService.create(data as any);
  return project.id || '';
}

/**
 * Update an existing project
 */
export async function update(id: string, data: Partial<ProjectFormData>): Promise<void> {
  await projectApiService.update(id, data as any);
}

/**
 * Delete a project
 */
export async function remove(id: string): Promise<void> {
  await projectApiService.delete(id);
}

/**
 * Get projects by client ID
 */
export async function getByClientId(clientId: string): Promise<Project[]> {
  return projectApiService.getProjectsByClient(clientId);
}

/**
 * Get active projects
 */
export async function getActiveProjects(): Promise<Project[]> {
  return projectApiService.getActiveProjects();
}
