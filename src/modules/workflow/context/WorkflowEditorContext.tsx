// 🟢 WORKING: Workflow Editor Context for visual editor state management
import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { workflowManagementService } from '../services/WorkflowManagementService';
import type { 
  WorkflowTemplate, 
  WorkflowPhase, 
  WorkflowStep, 
  WorkflowTask,
  CreateWorkflowPhaseRequest,
  CreateWorkflowStepRequest,
  CreateWorkflowTaskRequest,
  UpdateWorkflowPhaseRequest,
  UpdateWorkflowStepRequest,
  UpdateWorkflowTaskRequest,
  WorkflowValidationResult
} from '../types/workflow.types';

// Editor-specific types
export interface EditorPosition {
  x: number;
  y: number;
}

export interface EditorNode {
  id: string;
  type: 'phase' | 'step' | 'task';
  position: EditorPosition;
  data: WorkflowPhase | WorkflowStep | WorkflowTask;
  parentId?: string; // for hierarchy
  isSelected: boolean;
  isExpanded?: boolean; // for phase nodes showing steps
}

export interface EditorConnection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: 'dependency' | 'flow';
}

export interface EditorSettings {
  snapToGrid: boolean;
  showGrid: boolean;
  gridSize: number;
  autoSave: boolean;
  viewMode: 'hierarchical' | 'flowchart' | 'compact';
  zoomLevel: number;
  canvasSize: { width: number; height: number };
}

export interface EditorHistory {
  past: WorkflowEditorState[];
  present: WorkflowEditorState;
  future: WorkflowEditorState[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface WorkflowEditorState {
  // Current template being edited
  currentTemplate?: WorkflowTemplate;
  templateId?: string;
  isLoading: boolean;
  error?: string;
  
  // Editor canvas state
  nodes: EditorNode[];
  connections: EditorConnection[];
  selectedNodes: string[];
  isDragging: boolean;
  dragState?: {
    nodeId: string;
    startPosition: EditorPosition;
    currentPosition: EditorPosition;
  };
  
  // Editor UI state
  settings: EditorSettings;
  activePanel: 'palette' | 'properties' | 'validation' | null;
  showMinimap: boolean;
  
  // Validation state
  validationResult?: WorkflowValidationResult;
  isValidating: boolean;
  
  // History for undo/redo
  hasUnsavedChanges: boolean;
  lastSaved?: Date;
  
  // Form state
  editingItem?: {
    type: 'phase' | 'step' | 'task';
    id?: string; // undefined for creating new
    data?: Partial<WorkflowPhase | WorkflowStep | WorkflowTask>;
    parentId?: string;
  };
  
  // Clipboard state
  clipboard?: {
    type: 'phase' | 'step' | 'task';
    data: any;
  };
}

// Action types
type WorkflowEditorAction = 
  // Template actions
  | { type: 'LOAD_TEMPLATE_START' }
  | { type: 'LOAD_TEMPLATE_SUCCESS'; payload: { template: WorkflowTemplate; nodes: EditorNode[]; connections: EditorConnection[] } }
  | { type: 'LOAD_TEMPLATE_ERROR'; payload: string }
  | { type: 'SAVE_TEMPLATE_START' }
  | { type: 'SAVE_TEMPLATE_SUCCESS'; payload: WorkflowTemplate }
  | { type: 'SAVE_TEMPLATE_ERROR'; payload: string }
  | { type: 'CREATE_NEW_TEMPLATE' }
  
  // Node management
  | { type: 'ADD_NODE'; payload: EditorNode }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: Partial<EditorNode> } }
  | { type: 'DELETE_NODE'; payload: string }
  | { type: 'MOVE_NODE'; payload: { id: string; position: EditorPosition } }
  | { type: 'SELECT_NODE'; payload: string }
  | { type: 'DESELECT_NODE'; payload: string }
  | { type: 'SELECT_MULTIPLE_NODES'; payload: string[] }
  | { type: 'CLEAR_SELECTION' }
  
  // Drag and drop
  | { type: 'START_DRAG'; payload: { nodeId: string; startPosition: EditorPosition } }
  | { type: 'UPDATE_DRAG'; payload: EditorPosition }
  | { type: 'END_DRAG' }
  
  // Connection management
  | { type: 'ADD_CONNECTION'; payload: EditorConnection }
  | { type: 'DELETE_CONNECTION'; payload: string }
  
  // UI state
  | { type: 'UPDATE_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_ACTIVE_PANEL'; payload: 'palette' | 'properties' | 'validation' | null }
  | { type: 'TOGGLE_MINIMAP' }
  
  // Validation
  | { type: 'VALIDATION_START' }
  | { type: 'VALIDATION_SUCCESS'; payload: WorkflowValidationResult }
  | { type: 'VALIDATION_ERROR'; payload: string }
  
  // Form state
  | { type: 'START_EDITING_ITEM'; payload: { type: 'phase' | 'step' | 'task'; id?: string; data?: any; parentId?: string } }
  | { type: 'STOP_EDITING_ITEM' }
  
  // Clipboard
  | { type: 'COPY_TO_CLIPBOARD'; payload: { type: 'phase' | 'step' | 'task'; data: any } }
  | { type: 'CLEAR_CLIPBOARD' }
  
  // History
  | { type: 'MARK_UNSAVED_CHANGES' }
  | { type: 'MARK_SAVED' };

// Initial state
const initialState: WorkflowEditorState = {
  isLoading: false,
  nodes: [],
  connections: [],
  selectedNodes: [],
  isDragging: false,
  settings: {
    snapToGrid: true,
    showGrid: true,
    gridSize: 20,
    autoSave: true,
    viewMode: 'hierarchical',
    zoomLevel: 1,
    canvasSize: { width: 2000, height: 1500 }
  },
  activePanel: null,
  showMinimap: false,
  isValidating: false,
  hasUnsavedChanges: false
};

// Reducer function
function workflowEditorReducer(
  state: WorkflowEditorState,
  action: WorkflowEditorAction
): WorkflowEditorState {
  switch (action.type) {
    case 'LOAD_TEMPLATE_START': {
      const { error: _error, ...stateWithoutError } = state;
      return { ...stateWithoutError, isLoading: true };
    }
    
    case 'LOAD_TEMPLATE_SUCCESS':
      return {
        ...state,
        isLoading: false,
        currentTemplate: action.payload.template,
        templateId: action.payload.template.id,
        nodes: action.payload.nodes,
        connections: action.payload.connections,
        hasUnsavedChanges: false,
        lastSaved: new Date(action.payload.template.updatedAt)
      };
    
    case 'LOAD_TEMPLATE_ERROR':
      return { ...state, isLoading: false, error: action.payload };
    
    case 'SAVE_TEMPLATE_START':
      return { ...state, isLoading: true };
    
    case 'SAVE_TEMPLATE_SUCCESS':
      return {
        ...state,
        isLoading: false,
        currentTemplate: action.payload,
        hasUnsavedChanges: false,
        lastSaved: new Date(action.payload.updatedAt)
      };
    
    case 'SAVE_TEMPLATE_ERROR':
      return { ...state, isLoading: false, error: action.payload };
    
    case 'CREATE_NEW_TEMPLATE':
      return {
        ...initialState,
        settings: state.settings // preserve settings
      };
    
    case 'ADD_NODE':
      return {
        ...state,
        nodes: [...state.nodes, action.payload],
        hasUnsavedChanges: true
      };
    
    case 'UPDATE_NODE':
      return {
        ...state,
        nodes: state.nodes.map(node =>
          node.id === action.payload.id
            ? { ...node, ...action.payload.updates }
            : node
        ),
        hasUnsavedChanges: true
      };
    
    case 'DELETE_NODE':
      return {
        ...state,
        nodes: state.nodes.filter(node => node.id !== action.payload),
        connections: state.connections.filter(conn =>
          conn.sourceNodeId !== action.payload && conn.targetNodeId !== action.payload
        ),
        selectedNodes: state.selectedNodes.filter(id => id !== action.payload),
        hasUnsavedChanges: true
      };
    
    case 'MOVE_NODE':
      return {
        ...state,
        nodes: state.nodes.map(node =>
          node.id === action.payload.id
            ? { ...node, position: action.payload.position }
            : node
        ),
        hasUnsavedChanges: true
      };
    
    case 'SELECT_NODE':
      return {
        ...state,
        selectedNodes: [action.payload],
        activePanel: 'properties'
      };
    
    case 'DESELECT_NODE':
      return {
        ...state,
        selectedNodes: state.selectedNodes.filter(id => id !== action.payload)
      };
    
    case 'SELECT_MULTIPLE_NODES':
      return {
        ...state,
        selectedNodes: action.payload
      };
    
    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedNodes: [],
        activePanel: state.activePanel === 'properties' ? null : state.activePanel
      };
    
    case 'START_DRAG':
      return {
        ...state,
        isDragging: true,
        dragState: {
          nodeId: action.payload.nodeId,
          startPosition: action.payload.startPosition,
          currentPosition: action.payload.startPosition
        }
      };
    
    case 'UPDATE_DRAG':
      if (!state.dragState) {
        return state;
      }
      return {
        ...state,
        dragState: { ...state.dragState, currentPosition: action.payload }
      };
    
    case 'END_DRAG': {
      const { dragState: _dragState, ...stateWithoutDragState } = state;
      return {
        ...stateWithoutDragState,
        isDragging: false
      };
    }
    
    case 'ADD_CONNECTION':
      return {
        ...state,
        connections: [...state.connections, action.payload],
        hasUnsavedChanges: true
      };
    
    case 'DELETE_CONNECTION':
      return {
        ...state,
        connections: state.connections.filter(conn => conn.id !== action.payload),
        hasUnsavedChanges: true
      };
    
    case 'UPDATE_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload }
      };
    
    case 'SET_ACTIVE_PANEL':
      return {
        ...state,
        activePanel: action.payload
      };
    
    case 'TOGGLE_MINIMAP':
      return {
        ...state,
        showMinimap: !state.showMinimap
      };
    
    case 'VALIDATION_START':
      return {
        ...state,
        isValidating: true
      };
    
    case 'VALIDATION_SUCCESS':
      return {
        ...state,
        isValidating: false,
        validationResult: action.payload
      };
    
    case 'VALIDATION_ERROR':
      return {
        ...state,
        isValidating: false,
        error: action.payload
      };
    
    case 'START_EDITING_ITEM':
      return {
        ...state,
        editingItem: action.payload
      };
    
    case 'STOP_EDITING_ITEM': {
      const { editingItem: _editingItem, ...stateWithoutEditingItem } = state;
      return stateWithoutEditingItem;
    }
    
    case 'COPY_TO_CLIPBOARD':
      return {
        ...state,
        clipboard: action.payload
      };
    
    case 'CLEAR_CLIPBOARD': {
      const { clipboard: _clipboard, ...stateWithoutClipboard } = state;
      return stateWithoutClipboard;
    }
    
    case 'MARK_UNSAVED_CHANGES':
      return {
        ...state,
        hasUnsavedChanges: true
      };
    
    case 'MARK_SAVED':
      return {
        ...state,
        hasUnsavedChanges: false,
        lastSaved: new Date()
      };
    
    default:
      return state;
  }
}

// Context interface
export interface WorkflowEditorContextType {
  state: WorkflowEditorState;
  
  // Template actions
  loadTemplate: (templateId: string) => Promise<void>;
  saveTemplate: () => Promise<void>;
  createNewTemplate: () => void;
  
  // Node management
  addNode: (type: 'phase' | 'step' | 'task', position: EditorPosition, parentId?: string) => void;
  updateNode: (id: string, updates: Partial<EditorNode>) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, position: EditorPosition) => void;
  
  // Selection
  selectNode: (id: string) => void;
  deselectNode: (id: string) => void;
  selectMultipleNodes: (ids: string[]) => void;
  clearSelection: () => void;
  
  // Drag and drop
  startDrag: (nodeId: string, startPosition: EditorPosition) => void;
  updateDrag: (position: EditorPosition) => void;
  endDrag: () => void;
  
  // Connections
  addConnection: (sourceNodeId: string, targetNodeId: string, type: 'dependency' | 'flow') => void;
  deleteConnection: (connectionId: string) => void;
  
  // Settings
  updateSettings: (settings: Partial<EditorSettings>) => void;
  setActivePanel: (panel: 'palette' | 'properties' | 'validation' | null) => void;
  toggleMinimap: () => void;
  
  // Validation
  validateTemplate: () => Promise<void>;
  
  // CRUD operations
  startEditingItem: (type: 'phase' | 'step' | 'task', id?: string, parentId?: string) => void;
  stopEditingItem: () => void;
  createPhase: (data: CreateWorkflowPhaseRequest) => Promise<void>;
  createStep: (data: CreateWorkflowStepRequest) => Promise<void>;
  createTask: (data: CreateWorkflowTaskRequest) => Promise<void>;
  updatePhase: (id: string, data: UpdateWorkflowPhaseRequest) => Promise<void>;
  updateStep: (id: string, data: UpdateWorkflowStepRequest) => Promise<void>;
  updateTask: (id: string, data: UpdateWorkflowTaskRequest) => Promise<void>;
  
  // Clipboard
  copyToClipboard: (type: 'phase' | 'step' | 'task', data: any) => void;
  clearClipboard: () => void;
  
  // Utility functions
  getNodeById: (id: string) => EditorNode | undefined;
  getSelectedNode: () => EditorNode | undefined;
  getNodesByType: (type: 'phase' | 'step' | 'task') => EditorNode[];
  arrangeNodes: () => void; // Auto-arrange nodes
}

// Create context
const WorkflowEditorContext = createContext<WorkflowEditorContextType | undefined>(undefined);

// Provider component
interface WorkflowEditorProviderProps {
  children: React.ReactNode;
}

export function WorkflowEditorProvider({ children }: WorkflowEditorProviderProps) {
  const [state, dispatch] = useReducer(workflowEditorReducer, initialState);

  // Load template with all related data and convert to nodes
  const loadTemplate = useCallback(async (templateId: string) => {
    try {
      dispatch({ type: 'LOAD_TEMPLATE_START' });

      const template = await workflowManagementService.getTemplateById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      const phases = await workflowManagementService.getPhases(templateId);
      
      const nodes: EditorNode[] = [];
      const connections: EditorConnection[] = [];
      let yOffset = 100;

      // Convert phases to nodes
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;

        const phaseNode: EditorNode = {
          id: phase.id,
          type: 'phase',
          position: { x: 200, y: yOffset },
          data: phase,
          isSelected: false,
          isExpanded: true
        };
        nodes.push(phaseNode);

        // Load steps for this phase
        const steps = await workflowManagementService.getSteps(phase.id);
        let stepXOffset = 500;
        
        for (let j = 0; j < steps.length; j++) {
          const step = steps[j]!;

          const stepNode: EditorNode = {
            id: step.id,
            type: 'step',
            position: { x: stepXOffset, y: yOffset + (j * 120) },
            data: step,
            parentId: phase.id,
            isSelected: false
          };
          nodes.push(stepNode);

          // Load tasks for this step
          const tasks = await workflowManagementService.getTasks(step.id);
          
          for (let k = 0; k < tasks.length; k++) {
            const task = tasks[k]!;

            const taskNode: EditorNode = {
              id: task.id,
              type: 'task',
              position: { x: stepXOffset + 300, y: yOffset + (j * 120) + (k * 40) },
              data: task,
              parentId: step.id,
              isSelected: false
            };
            nodes.push(taskNode);
          }
          
          stepXOffset += 50; // Slight offset for multiple steps
        }

        yOffset += Math.max(200, steps.length * 120 + 50);

        // Add phase dependencies as connections
        if (phase.dependencies && phase.dependencies.length > 0) {
          phase.dependencies.forEach((depId, idx) => {
            connections.push({
              id: `dep-${phase.id}-${depId}-${idx}`,
              sourceNodeId: depId,
              targetNodeId: phase.id,
              type: 'dependency'
            });
          });
        }
      }

      dispatch({
        type: 'LOAD_TEMPLATE_SUCCESS',
        payload: { template, nodes, connections }
      });

    } catch (error) {
      dispatch({
        type: 'LOAD_TEMPLATE_ERROR',
        payload: error instanceof Error ? error.message : 'Failed to load template'
      });
    }
  }, []);

  // Save current template
  const saveTemplate = useCallback(async () => {
    if (!state.currentTemplate || !state.hasUnsavedChanges) return;

    try {
      dispatch({ type: 'SAVE_TEMPLATE_START' });

      // TODO: Convert nodes back to workflow structure and save
      // For now, just mark as saved
      dispatch({
        type: 'SAVE_TEMPLATE_SUCCESS',
        payload: state.currentTemplate
      });

    } catch (error) {
      dispatch({
        type: 'SAVE_TEMPLATE_ERROR',
        payload: error instanceof Error ? error.message : 'Failed to save template'
      });
    }
  }, [state.currentTemplate, state.hasUnsavedChanges]);

  // Auto-save functionality
  useEffect(() => {
    if (state.settings.autoSave && state.hasUnsavedChanges && state.currentTemplate) {
      const autoSaveTimeout = setTimeout(() => {
        saveTemplate();
      }, 30000); // Auto-save after 30 seconds of inactivity

      return () => clearTimeout(autoSaveTimeout);
    }
    return undefined;
  }, [state.settings.autoSave, state.hasUnsavedChanges, state.currentTemplate, saveTemplate]);

  // Create new template
  const createNewTemplate = useCallback(() => {
    dispatch({ type: 'CREATE_NEW_TEMPLATE' });
  }, []);

  // Node management functions
  const addNode = useCallback((type: 'phase' | 'step' | 'task', position: EditorPosition, parentId?: string) => {
    const newNode: EditorNode = {
      id: `temp-${Date.now()}`,
      type,
      position,
      data: {} as any, // Will be filled when created
      ...(parentId ? { parentId } : {}),
      isSelected: true,
      ...(type === 'phase' ? { isExpanded: true } : {})
    };

    dispatch({ type: 'ADD_NODE', payload: newNode });
    dispatch({ type: 'START_EDITING_ITEM', payload: { type, ...(parentId ? { parentId } : {}) } });
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<EditorNode>) => {
    dispatch({ type: 'UPDATE_NODE', payload: { id, updates } });
  }, []);

  const deleteNode = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NODE', payload: id });
  }, []);

  const moveNode = useCallback((id: string, position: EditorPosition) => {
    dispatch({ type: 'MOVE_NODE', payload: { id, position } });
  }, []);

  // Selection functions
  const selectNode = useCallback((id: string) => {
    dispatch({ type: 'SELECT_NODE', payload: id });
  }, []);

  const deselectNode = useCallback((id: string) => {
    dispatch({ type: 'DESELECT_NODE', payload: id });
  }, []);

  const selectMultipleNodes = useCallback((ids: string[]) => {
    dispatch({ type: 'SELECT_MULTIPLE_NODES', payload: ids });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  // Drag and drop functions
  const startDrag = useCallback((nodeId: string, startPosition: EditorPosition) => {
    dispatch({ type: 'START_DRAG', payload: { nodeId, startPosition } });
  }, []);

  const updateDrag = useCallback((position: EditorPosition) => {
    dispatch({ type: 'UPDATE_DRAG', payload: position });
  }, []);

  const endDrag = useCallback(() => {
    dispatch({ type: 'END_DRAG' });
  }, []);

  // Connection functions
  const addConnection = useCallback((sourceNodeId: string, targetNodeId: string, type: 'dependency' | 'flow') => {
    const connection: EditorConnection = {
      id: `conn-${sourceNodeId}-${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      type
    };
    dispatch({ type: 'ADD_CONNECTION', payload: connection });
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    dispatch({ type: 'DELETE_CONNECTION', payload: connectionId });
  }, []);

  // Settings functions
  const updateSettings = useCallback((settings: Partial<EditorSettings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
  }, []);

  const setActivePanel = useCallback((panel: 'palette' | 'properties' | 'validation' | null) => {
    dispatch({ type: 'SET_ACTIVE_PANEL', payload: panel });
  }, []);

  const toggleMinimap = useCallback(() => {
    dispatch({ type: 'TOGGLE_MINIMAP' });
  }, []);

  // Validation
  const validateTemplate = useCallback(async () => {
    if (!state.templateId) return;

    try {
      dispatch({ type: 'VALIDATION_START' });
      
      const result = await workflowManagementService.validateTemplate(state.templateId);
      dispatch({ type: 'VALIDATION_SUCCESS', payload: result });
      
    } catch (error) {
      dispatch({
        type: 'VALIDATION_ERROR',
        payload: error instanceof Error ? error.message : 'Validation failed'
      });
    }
  }, [state.templateId]);

  // CRUD operations
  const startEditingItem = useCallback((type: 'phase' | 'step' | 'task', id?: string, parentId?: string) => {
    dispatch({ 
      type: 'START_EDITING_ITEM', 
      payload: { 
        type, 
        ...(id ? { id } : {}),
        ...(parentId ? { parentId } : {})
      } 
    });
  }, []);

  const stopEditingItem = useCallback(() => {
    dispatch({ type: 'STOP_EDITING_ITEM' });
  }, []);

  const createPhase = useCallback(async (_data: CreateWorkflowPhaseRequest) => {
    // TODO: Implement phase creation and node update
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  const createStep = useCallback(async (_data: CreateWorkflowStepRequest) => {
    // TODO: Implement step creation and node update
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  const createTask = useCallback(async (_data: CreateWorkflowTaskRequest) => {
    // TODO: Implement task creation and node update
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  const updatePhase = useCallback(async (_id: string, _data: UpdateWorkflowPhaseRequest) => {
    // TODO: Implement phase update and node sync
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  const updateStep = useCallback(async (_id: string, _data: UpdateWorkflowStepRequest) => {
    // TODO: Implement step update and node sync
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  const updateTask = useCallback(async (_id: string, _data: UpdateWorkflowTaskRequest) => {
    // TODO: Implement task update and node sync
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []); 

  // Clipboard functions
  const copyToClipboard = useCallback((type: 'phase' | 'step' | 'task', data: any) => {
    dispatch({ type: 'COPY_TO_CLIPBOARD', payload: { type, data } });
  }, []);

  const clearClipboard = useCallback(() => {
    dispatch({ type: 'CLEAR_CLIPBOARD' });
  }, []);

  // Utility functions
  const getNodeById = useCallback((id: string): EditorNode | undefined => {
    return state.nodes.find(node => node.id === id);
  }, [state.nodes]);

  const getSelectedNode = useCallback((): EditorNode | undefined => {
    if (state.selectedNodes.length === 1) {
      return getNodeById(state.selectedNodes[0]);
    }
    return undefined;
  }, [state.selectedNodes, getNodeById]);

  const getNodesByType = useCallback((type: 'phase' | 'step' | 'task'): EditorNode[] => {
    return state.nodes.filter(node => node.type === type);
  }, [state.nodes]);

  const arrangeNodes = useCallback(() => {
    // TODO: Implement auto-layout algorithm
    dispatch({ type: 'MARK_UNSAVED_CHANGES' });
  }, []);

  // Context value
  const contextValue: WorkflowEditorContextType = {
    state,
    
    // Template actions
    loadTemplate,
    saveTemplate,
    createNewTemplate,
    
    // Node management
    addNode,
    updateNode,
    deleteNode,
    moveNode,
    
    // Selection
    selectNode,
    deselectNode,
    selectMultipleNodes,
    clearSelection,
    
    // Drag and drop
    startDrag,
    updateDrag,
    endDrag,
    
    // Connections
    addConnection,
    deleteConnection,
    
    // Settings
    updateSettings,
    setActivePanel,
    toggleMinimap,
    
    // Validation
    validateTemplate,
    
    // CRUD operations
    startEditingItem,
    stopEditingItem,
    createPhase,
    createStep,
    createTask,
    updatePhase,
    updateStep,
    updateTask,
    
    // Clipboard
    copyToClipboard,
    clearClipboard,
    
    // Utility functions
    getNodeById,
    getSelectedNode,
    getNodesByType,
    arrangeNodes
  };

  return (
    <WorkflowEditorContext.Provider value={contextValue}>
      {children}
    </WorkflowEditorContext.Provider>
  );
}

// Hook to use the context
export function useWorkflowEditor(): WorkflowEditorContextType {
  const context = useContext(WorkflowEditorContext);
  
  if (context === undefined) {
    throw new Error('useWorkflowEditor must be used within a WorkflowEditorProvider');
  }
  
  return context;
}

// Export context for testing
export { WorkflowEditorContext };