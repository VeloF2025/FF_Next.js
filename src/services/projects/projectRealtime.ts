import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import type { RealtimeEvent } from '@/services/realtime/websocketService';
import { log } from '@/lib/logger';
import { 
  Project,
  ProjectHierarchy,
  Phase,
  Step,
  Task
} from '@/types/project.types';

/**
 * Subscribe to real-time project updates via WebSocket
 */
export function subscribeToProject(
  projectId: string,
  callback: (project: Project | null) => void
): () => void {
  // Ensure WebSocket is connected
  if (!socketIOAdapter.isConnected()) {
    socketIOAdapter.connect().catch(err => log.error('Failed to connect WebSocket', { data: err }, 'projectRealtime'));
  }

  // Subscribe to specific project changes
  const unsubscribe = socketIOAdapter.subscribe(
    'project',
    projectId,
    async (event: RealtimeEvent) => {
      if (event.type === 'removed') {
        callback(null);
      } else {
        // Fetch fresh data for added/modified events
        try {
          const response = await fetch(`/api/projects/${projectId}`);
          if (response.ok) {
            const project = await response.json();
            callback(project);
          } else {
            callback(null);
          }
        } catch (error) {
          log.error('Error fetching project data:', { data: error }, 'projectRealtime');
          callback(null);
        }
      }
    }
  );

  // Fetch initial data
  fetch(`/api/projects/${projectId}`)
    .then(res => res.ok ? res.json() : null)
    .then(callback)
    .catch(() => callback(null));

  return unsubscribe;
}

/**
 * Subscribe to real-time project list updates via WebSocket
 */
export function subscribeToProjects(
  callback: (projects: Project[]) => void,
  filter?: { status?: string; clientId?: string }
): () => void {
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
        let url = '/api/projects';
        const params = new URLSearchParams();
        if (filter?.status) params.append('status', filter.status);
        if (filter?.clientId) params.append('clientId', filter.clientId);
        if (params.toString()) url += `?${params.toString()}`;
        
        const response = await fetch(url);
        if (response.ok) {
          const projects = await response.json();
          callback(projects);
        } else {
          callback([]);
        }
      } catch (error) {
        log.error('Error fetching projects list:', { data: error }, 'projectRealtime');
        callback([]);
      }
    }
  );

  // Fetch initial data
  let url = '/api/projects';
  const params = new URLSearchParams();
  if (filter?.status) params.append('status', filter.status);
  if (filter?.clientId) params.append('clientId', filter.clientId);
  if (params.toString()) url += `?${params.toString()}`;
  
  fetch(url)
    .then(res => res.ok ? res.json() : [])
    .then(callback)
    .catch(() => callback([]));

  return unsubscribe;
}

/**
 * Subscribe to project phases updates
 * Note: This would need a separate API endpoint for phases
 */
export function subscribeToProjectPhases(
  projectId: string,
  callback: (phases: Phase[]) => void
): () => void {
  // For now, return empty unsubscribe as phases would need separate API support
  log.warn('Phase subscriptions not yet implemented for WebSocket', {}, 'projectRealtime');
  callback([]);
  return () => {};
}

/**
 * Subscribe to phase steps updates
 * Note: This would need a separate API endpoint for steps
 */
export function subscribeToPhaseSteps(
  projectId: string,
  phaseId: string,
  callback: (steps: Step[]) => void
): () => void {
  // For now, return empty unsubscribe as steps would need separate API support
  log.warn('Step subscriptions not yet implemented for WebSocket', {}, 'projectRealtime');
  callback([]);
  return () => {};
}

/**
 * Subscribe to step tasks updates
 * Note: This would need a separate API endpoint for tasks
 */
export function subscribeToStepTasks(
  projectId: string,
  phaseId: string,
  stepId: string,
  callback: (tasks: Task[]) => void
): () => void {
  // For now, return empty unsubscribe as tasks would need separate API support
  log.warn('Task subscriptions not yet implemented for WebSocket', {}, 'projectRealtime');
  callback([]);
  return () => {};
}

/**
 * Subscribe to complete project hierarchy
 */
export function subscribeToProjectHierarchy(
  projectId: string,
  callback: (hierarchy: ProjectHierarchy | null) => void
): (() => void)[] {
  const unsubscribes: (() => void)[] = [];
  const hierarchy: ProjectHierarchy = {
    project: null as any,
    phases: []
  };
  
  // Subscribe to project
  unsubscribes.push(
    subscribeToProject(projectId, (project) => {
      if (!project) {
        callback(null);
        return;
      }
      hierarchy.project = project;
      callback({ ...hierarchy });
    })
  );
  
  // Subscribe to phases
  unsubscribes.push(
    subscribeToProjectPhases(projectId, async (phases) => {
      hierarchy.phases = [];
      
      for (const phase of phases) {
        const phaseWithSteps: Phase & { steps?: Step[] } = { ...phase, steps: [] };
        
        // Note: Steps and tasks would need separate API endpoints
        // For now, just add the phase without nested data
        hierarchy.phases.push(phaseWithSteps);
      }
      
      callback({ ...hierarchy });
    })
  );
  
  return unsubscribes;
}

/**
 * Unsubscribe from multiple subscriptions
 */
export function unsubscribeAll(unsubscribes: (() => void)[]): void {
  unsubscribes.forEach(unsubscribe => unsubscribe());
}