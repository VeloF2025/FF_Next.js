/**
 * Project Service - Main export file
 * Using Neon PostgreSQL for all operations
 */

// CRUD operations (Neon-based)
export {
  getAll,
  getById,
  create,
  update,
  remove,
  getByClientId,
  getActiveProjects
} from './projectCrud';

// Phases and hierarchy management - TEMPORARILY DISABLED (uses Firebase)
// TODO: Migrate to Neon
// export {
//   generateProjectPhases,
//   getProjectPhases,
//   getPhaseById,
//   updatePhase,
//   getPhaseSteps,
//   updateStep,
//   getStepTasks,
//   createTask,
//   updateTask
// } from './projectPhases';

// Statistics and analytics - TEMPORARILY DISABLED (uses Firebase)
// TODO: Migrate to Neon
// export {
//   getProjectSummary,
//   getRecentProjects,
//   getOverdueProjects,
//   getProjectsByStatus,
//   getProjectCountByType,
//   getProjectsEndingSoon,
//   calculateBudgetVariance
// } from './projectStats';

// Real-time subscriptions - REMOVED (Firebase-specific feature)
// Not needed with Neon PostgreSQL
// export {
//   subscribeToProject,
//   subscribeToProjects,
//   subscribeToProjectPhases,
//   subscribeToPhaseSteps,
//   subscribeToStepTasks,
//   subscribeToProjectHierarchy,
//   unsubscribeAll
// } from './projectRealtime';

// Create the projectService object for backward compatibility
import * as crud from './projectCrud';
// Removed Firebase imports - only using Neon CRUD operations

export const projectService = {
  // CRUD operations (Neon-based)
  getAll: crud.getAll,
  getById: crud.getById,
  create: crud.create,
  update: crud.update,
  delete: crud.remove,
  remove: crud.remove,
  getByClientId: crud.getByClientId,
  getActiveProjects: crud.getActiveProjects,
  
  // Placeholder functions for backward compatibility
  // These return empty data until migrated to Neon
  generatePhases: async (_projectId?: string, _projectType?: string) => [],
  getPhases: async () => [],
  getPhase: async () => null,
  updatePhase: async () => ({}),
  getSteps: async () => [],
  updateStep: async () => ({}),
  getTasks: async () => [],
  createTask: async () => ({}),
  updateTask: async () => ({}),
  initializeProjectPhases: async () => [],
  
  // Stats placeholders
  getSummary: async () => ({ total: 0, active: 0, completed: 0 }),
  getRecent: async () => [],
  getOverdue: async () => [],
  getByStatus: async () => [],
  getCountByType: async () => ({}),
  getEndingSoon: async () => [],
  calculateBudgetVariance: async () => 0,
  getProjectSummary: async () => ({ total: 0, active: 0, completed: 0 }),
  getProjectHierarchy: async () => null,
  
  // Real-time placeholders (not needed with Neon)
  subscribe: () => () => {},
  subscribeToList: () => () => {},
  subscribeToPhases: () => () => {},
  subscribeToSteps: () => () => {},
  subscribeToTasks: () => () => {},
  subscribeToHierarchy: () => () => {},
  unsubscribeAll: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribeToProject: (_id?: string, _cb?: (p: any) => void) => () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribeToProjects: (_cb?: (p: any[]) => void, _filter?: unknown) => () => {} // Placeholder
};