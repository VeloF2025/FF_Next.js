// 🟢 WORKING: Workflow Portal Context for state management
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { workflowManagementService } from '../services/WorkflowManagementService';
// WorkflowTemplateService import removed - using workflowManagementService
import { log } from '@/lib/logger';
import type { 
  WorkflowPortalContext as IWorkflowPortalContext,
  WorkflowTabId,
  TemplateStats,
  ProjectWorkflowStats,
  WorkflowTabBadge
} from '../types/portal.types';
import type {
  WorkflowTemplate,
  ProjectWorkflow,
  CreateProjectWorkflowRequest,
} from '../types/workflow.types';

// Initial state
const initialState: Omit<IWorkflowPortalContext, 
  'setActiveTab' | 'setLoading' | 'setError' | 'updateTabBadge' | 'refreshData' | 
  'loadTemplateStats' | 'loadProjectWorkflowStats' | 'loadProjectWorkflows' | 
  'loadTemplates' | 'createProjectWorkflow'> = {
  activeTab: 'templates',
  isLoading: false,
  error: undefined,
  templateStats: {
    totalTemplates: 0,
    activeTemplates: 0,
    draftTemplates: 0,
    archivedTemplates: 0,
    recentlyUpdated: 0
  },
  projectWorkflowStats: {
    totalProjectWorkflows: 0,
    activeWorkflows: 0,
    completedWorkflows: 0,
    pausedWorkflows: 0,
    overdueWorkflows: 0,
    recentlyUpdated: 0
  },
  projectWorkflows: [],
  templates: [],
  tabBadges: {
    templates: {},
    editor: {},
    projects: {},
    analytics: {}
  }
};

// Action types
type WorkflowPortalAction = 
  | { type: 'SET_ACTIVE_TAB'; payload: WorkflowTabId }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload?: string }
  | { type: 'SET_TEMPLATE_STATS'; payload: TemplateStats }
  | { type: 'SET_PROJECT_WORKFLOW_STATS'; payload: ProjectWorkflowStats }
  | { type: 'SET_PROJECT_WORKFLOWS'; payload: ProjectWorkflow[] }
  | { type: 'SET_TEMPLATES'; payload: WorkflowTemplate[] }
  | { type: 'UPDATE_TAB_BADGE'; payload: { tabId: WorkflowTabId; badge?: WorkflowTabBadge } };

// Reducer function
function workflowPortalReducer(
  state: typeof initialState, 
  action: WorkflowPortalAction
): typeof initialState {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
      
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
      
    case 'SET_ERROR':
      return { ...state, error: action.payload };
      
    case 'SET_TEMPLATE_STATS':
      return { ...state, templateStats: action.payload };
      
    case 'SET_PROJECT_WORKFLOW_STATS':
      return { ...state, projectWorkflowStats: action.payload };
      
    case 'SET_PROJECT_WORKFLOWS':
      return { ...state, projectWorkflows: action.payload };
      
    case 'SET_TEMPLATES':
      return { ...state, templates: action.payload };
      
    case 'UPDATE_TAB_BADGE':
      return {
        ...state,
        tabBadges: {
          ...state.tabBadges,
          [action.payload.tabId]: action.payload.badge || {}
        }
      };
      
    default:
      return state;
  }
}

// Create context
const WorkflowPortalContext = createContext<IWorkflowPortalContext | undefined>(undefined);

// Provider component
interface WorkflowPortalProviderProps {
  children: React.ReactNode;
}

export function WorkflowPortalProvider({ children }: WorkflowPortalProviderProps) {
  const [state, dispatch] = useReducer(workflowPortalReducer, initialState);

  // Action creators
  const setActiveTab = useCallback((tab: WorkflowTabId) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    
    // Persist active tab to session storage
    sessionStorage.setItem('workflowActiveTab', tab);
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const setError = useCallback((error?: string) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const updateTabBadge = useCallback((tabId: WorkflowTabId, badge?: WorkflowTabBadge) => {
    dispatch({ type: 'UPDATE_TAB_BADGE', payload: { tabId, badge } });
  }, []);

  // Load template statistics
  const loadTemplateStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(undefined);

      const templatesResult = await workflowManagementService.getTemplates({
        limit: 1000 // Get all templates for stats
      });

      const templates = templatesResult.templates;
      const stats: TemplateStats = {
        totalTemplates: templates.length,
        activeTemplates: templates.filter(t => t.status === 'active').length,
        draftTemplates: templates.filter(t => t.status === 'draft').length,
        archivedTemplates: templates.filter(t => t.status === 'archived').length,
        recentlyUpdated: templates.filter(t => {
          const updatedDate = new Date(t.updatedAt);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return updatedDate > sevenDaysAgo;
        }).length
      };

      dispatch({ type: 'SET_TEMPLATE_STATS', payload: stats });

      // Update tab badges based on stats
      updateTabBadge('templates', {
        count: stats.totalTemplates,
        type: stats.totalTemplates > 0 ? 'info' : undefined
      });

      updateTabBadge('editor', stats.draftTemplates > 0 ? {
        count: stats.draftTemplates,
        type: 'warning'
      } : undefined);

      updateTabBadge('projects', {
        count: 0, // TODO: Load actual project workflow count
        type: 'info'
      });

    } catch (error) {
      log.error('Error loading template stats:', { data: error }, 'WorkflowPortalContext');
      setError(error instanceof Error ? error.message : 'Failed to load template statistics');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, updateTabBadge]);

  // Load project workflow statistics
  const loadProjectWorkflowStats = useCallback(async () => {
    try {
      // Mock project workflow stats - in real implementation, this would come from API
      const mockStats: ProjectWorkflowStats = {
        totalProjectWorkflows: state.projectWorkflows.length,
        activeWorkflows: state.projectWorkflows.filter(w => w.status === 'active').length,
        completedWorkflows: state.projectWorkflows.filter(w => w.status === 'completed').length,
        pausedWorkflows: state.projectWorkflows.filter(w => w.status === 'paused').length,
        overdueWorkflows: state.projectWorkflows.filter(w => {
          if (!w.plannedEndDate || w.status !== 'active') return false;
          return new Date(w.plannedEndDate) < new Date();
        }).length,
        recentlyUpdated: state.projectWorkflows.filter(w => {
          const updatedDate = new Date(w.updatedAt);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return updatedDate > sevenDaysAgo;
        }).length
      };

      dispatch({ type: 'SET_PROJECT_WORKFLOW_STATS', payload: mockStats });

      // Update projects tab badge
      updateTabBadge('projects', {
        count: mockStats.totalProjectWorkflows,
        type: mockStats.overdueWorkflows > 0 ? 'error' : 
              mockStats.activeWorkflows > 0 ? 'info' : undefined
      });
    } catch (error) {
      log.error('Error loading project workflow stats:', { data: error }, 'WorkflowPortalContext');
    }
  }, [state.projectWorkflows, updateTabBadge]);

  // Load project workflows
  const loadProjectWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      // Mock project workflows - in real implementation, this would use workflowManagementService
      const mockWorkflows: ProjectWorkflow[] = [
        {
          id: '1',
          projectId: 'proj-1',
          workflowTemplateId: 'template-1',
          name: 'Fiber Installation Workflow - Downtown Project',
          status: 'active',
          currentPhaseId: 'phase-2',
          progressPercentage: 35,
          startDate: '2024-01-15T00:00:00Z',
          plannedEndDate: '2024-06-30T00:00:00Z',
          assignedTo: 'user-1',
          teamMembers: ['user-1', 'user-2', 'user-3'],
          metrics: {},
          createdAt: '2024-01-10T00:00:00Z',
          updatedAt: '2024-01-20T00:00:00Z'
        },
        {
          id: '2',
          projectId: 'proj-2',
          workflowTemplateId: 'template-2',
          name: 'Network Upgrade Workflow - Residential Area',
          status: 'paused',
          progressPercentage: 60,
          startDate: '2024-02-01T00:00:00Z',
          plannedEndDate: '2024-08-15T00:00:00Z',
          assignedTo: 'user-2',
          teamMembers: ['user-2', 'user-4'],
          metrics: {},
          createdAt: '2024-01-25T00:00:00Z',
          updatedAt: '2024-02-05T00:00:00Z'
        }
      ];
      
      dispatch({ type: 'SET_PROJECT_WORKFLOWS', payload: mockWorkflows });
    } catch (error) {
      log.error('Error loading project workflows:', { data: error }, 'WorkflowPortalContext');
      setError(error instanceof Error ? error.message : 'Failed to load project workflows');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  // Load templates
  const loadTemplates = useCallback(async () => {
    try {
      const templatesResult = await workflowManagementService.getTemplates({
        status: 'active',
        limit: 100
      });
      dispatch({ type: 'SET_TEMPLATES', payload: templatesResult.templates });
    } catch (error) {
      log.error('Error loading templates:', { data: error }, 'WorkflowPortalContext');
      setError(error instanceof Error ? error.message : 'Failed to load templates');
    }
  }, [setError]);

  // Create project workflow
  const createProjectWorkflow = useCallback(async (workflowData: CreateProjectWorkflowRequest) => {
    try {
      setLoading(true);
      // In real implementation, this would use workflowManagementService
      log.info('Creating project workflow:', { data: workflowData }, 'WorkflowPortalContext');
      
      // Mock creation and refresh data
      await loadProjectWorkflows();
      await loadProjectWorkflowStats();
    } catch (error) {
      log.error('Error creating project workflow:', { data: error }, 'WorkflowPortalContext');
      setError(error instanceof Error ? error.message : 'Failed to create project workflow');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, loadProjectWorkflows, loadProjectWorkflowStats]);

  // Refresh all data
  const refreshData = useCallback(async () => {
    await Promise.all([
      loadTemplateStats(),
      loadProjectWorkflows(),
      loadTemplates()
    ]);
    await loadProjectWorkflowStats();
  }, [loadTemplateStats, loadProjectWorkflows, loadTemplates, loadProjectWorkflowStats]);

  // Refresh templates only (for analytics)
  const refreshTemplates = useCallback(async () => {
    await loadTemplates();
  }, [loadTemplates]);

  // Load initial data on mount
  useEffect(() => {
    // Restore active tab from session storage
    const savedTab = sessionStorage.getItem('workflowActiveTab') as WorkflowTabId;
    if (savedTab && savedTab !== state.activeTab) {
      setActiveTab(savedTab);
    }

    // Load initial data
    refreshData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Context value
  const contextValue: IWorkflowPortalContext = {
    ...state,
    setActiveTab,
    setLoading,
    setError,
    updateTabBadge,
    refreshData,
    refreshTemplates,
    loadTemplateStats,
    loadProjectWorkflowStats,
    loadProjectWorkflows,
    loadTemplates,
    createProjectWorkflow
  };

  return (
    <WorkflowPortalContext.Provider value={contextValue}>
      {children}
    </WorkflowPortalContext.Provider>
  );
}

// Custom hook to use the context
export function useWorkflowPortal(): IWorkflowPortalContext {
  const context = useContext(WorkflowPortalContext);
  
  if (context === undefined) {
    throw new Error('useWorkflowPortal must be used within a WorkflowPortalProvider');
  }
  
  return context;
}

// Export context for testing purposes
export { WorkflowPortalContext };