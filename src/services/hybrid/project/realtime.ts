/**
 * Real-time Project Operations (WebSocket)
 */

import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import type { RealtimeEvent } from '@/services/realtime/websocketService';
import type { Project } from '@/types/project.types';
import { log } from '@/lib/logger';

/**
 * Get all projects (via API)
 */
export async function getAllProjects(): Promise<Project[]> {
  const response = await fetch('/api/projects');
  if (!response.ok) {
    throw new Error('Failed to fetch projects');
  }
  return response.json();
}

/**
 * Get project by ID (via API)
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const response = await fetch(`/api/projects/${id}`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('Failed to fetch project');
  }
  return response.json();
}

/**
 * Create new project (via API)
 */
export async function createProject(projectData: Omit<Project, 'id'>): Promise<string> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...projectData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create project');
  }

  const result = await response.json();
  
  // Broadcast change via WebSocket
  socketIOAdapter.broadcastChange({
    eventType: 'added',
    entityType: 'project',
    entityId: result.id,
    data: { ...projectData, id: result.id }
  });

  return result.id;
}

/**
 * Update project (via API)
 */
export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...updates,
      updatedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to update project');
  }

  // Broadcast change via WebSocket
  socketIOAdapter.broadcastChange({
    eventType: 'modified',
    entityType: 'project',
    entityId: id,
    data: updates
  });
}

/**
 * Delete project (via API)
 */
export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete project');
  }

  // Broadcast change via WebSocket
  socketIOAdapter.broadcastChange({
    eventType: 'removed',
    entityType: 'project',
    entityId: id,
    data: null
  });
}

/**
 * Subscribe to project changes (real-time via WebSocket)
 */
export function subscribeToProject(id: string, callback: (project: Project | null) => void): () => void {
  // Ensure WebSocket is connected
  if (!socketIOAdapter.isConnected()) {
    socketIOAdapter.connect().catch(err => log.error('Failed to connect WebSocket', { data: err }, 'projectRealtime'));
  }

  // Subscribe to specific project changes
  const unsubscribe = socketIOAdapter.subscribe(
    'project',
    id,
    async (event: RealtimeEvent) => {
      if (event.type === 'removed') {
        callback(null);
      } else {
        // Fetch fresh data for added/modified events
        try {
          const project = await getProjectById(id);
          callback(project);
        } catch (error) {
          log.error('Error fetching project data', { data: error }, 'projectRealtime');
          callback(null);
        }
      }
    }
  );

  // Fetch initial data
  getProjectById(id).then(callback).catch(() => callback(null));

  return unsubscribe;
}

/**
 * Subscribe to projects list (real-time via WebSocket)
 */
export function subscribeToProjects(callback: (projects: Project[]) => void): () => void {
  // Ensure WebSocket is connected
  if (!socketIOAdapter.isConnected()) {
    socketIOAdapter.connect().catch(err => log.error('Failed to connect WebSocket', { data: err }, 'projectRealtime'));
  }

  // Subscribe to all project changes
  const unsubscribe = socketIOAdapter.subscribeToAll(
    'project',
    async (event: RealtimeEvent) => {
      // Re-fetch the entire list on any change
      try {
        const projects = await getAllProjects();
        callback(projects);
      } catch (error) {
        log.error('Error fetching projects list', { data: error }, 'projectRealtime');
        callback([]);
      }
    }
  );

  // Fetch initial data
  getAllProjects().then(callback).catch(() => callback([]));

  return unsubscribe;
}