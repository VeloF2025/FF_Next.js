/**
 * Project CRUD Service
 * Handles basic Create, Read, Update, Delete operations for projects
 * Using API routes for browser, Neon for server/build
 *
 * NOTE: Server-only imports (Neon) are dynamically loaded to prevent
 * bundling server code into client-side JavaScript.
 */

import { projectApiService } from '../project/projectApiService';
import type { Project, ProjectFormData, ProjectFilter } from '@/types/project.types';
import { ProjectStatus } from '@/types/project.types';

// Check if running in browser
const isBrowser = typeof window !== 'undefined';

// Lazy-load Neon service only on server to prevent client bundling
let _neonService: typeof import('./projectNeonService').projectNeonService | null = null;
async function getNeonService() {
  if (!_neonService) {
    const mod = await import('./projectNeonService');
    _neonService = mod.projectNeonService;
  }
  return _neonService;
}

/**
 * Get all projects with optional filtering
 */
export async function getAll(filter?: ProjectFilter): Promise<Project[]> {
  if (isBrowser) {
    // API service doesn't support filtering yet, so get all and filter client-side
    const projects = await projectApiService.getAll();
    if (!filter) return projects;

    return projects.filter(project => {
      if (filter.status && !filter.status.includes(project.status as ProjectStatus)) return false;
      if (filter.clientId && !filter.clientId.includes(project.client_id || '')) return false;
      if (filter.projectType && !filter.projectType.includes(project.project_type || '')) return false;
      return true;
    });
  }
  const neonService = await getNeonService();
  return neonService.getAll(filter);
}

/**
 * Get a single project by ID
 */
export async function getById(id: string): Promise<Project | null> {
  if (isBrowser) {
    return projectApiService.getById(id);
  }
  const neonService = await getNeonService();
  return neonService.getById(id);
}

/**
 * Create a new project
 */
export async function create(data: ProjectFormData): Promise<string> {
  if (isBrowser) {
    const project = await projectApiService.create(data as any);
    return project.id || '';
  }
  const neonService = await getNeonService();
  return neonService.create(data);
}

/**
 * Update an existing project
 */
export async function update(id: string, data: Partial<ProjectFormData>): Promise<void> {
  if (isBrowser) {
    await projectApiService.update(id, data as any);
    return;
  }
  const neonService = await getNeonService();
  return neonService.update(id, data);
}

/**
 * Delete a project
 */
export async function remove(id: string): Promise<void> {
  if (isBrowser) {
    await projectApiService.delete(id);
    return;
  }
  const neonService = await getNeonService();
  return neonService.remove(id);
}

/**
 * Get projects by client ID
 */
export async function getByClientId(clientId: string): Promise<Project[]> {
  if (isBrowser) {
    return projectApiService.getProjectsByClient(clientId);
  }
  const neonService = await getNeonService();
  return neonService.getAll({ clientId: [clientId] });
}

/**
 * Get active projects
 */
export async function getActiveProjects(): Promise<Project[]> {
  if (isBrowser) {
    return projectApiService.getActiveProjects();
  }
  const neonService = await getNeonService();
  return neonService.getAll({ status: [ProjectStatus.ACTIVE] });
}