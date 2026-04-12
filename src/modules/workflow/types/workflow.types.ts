// Workflow Management System Types
// Complete type definitions for the customizable workflow management system

// Base types
export type WorkflowStatus = 'active' | 'archived' | 'draft';
export type WorkflowType = 'default' | 'custom' | 'system';
export type WorkflowCategory = 'project' | 'maintenance' | 'emergency' | 'telecommunications';
export type StepType = 'task' | 'approval' | 'review' | 'milestone';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ProjectWorkflowStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type WorkflowAction = 'started' | 'completed' | 'paused' | 'cancelled' | 'assigned' | 'updated';

// Core workflow template structure
export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  category: WorkflowCategory;
  type: WorkflowType;
  status: WorkflowStatus;
  version: string;
  isDefault: boolean;
  isSystem: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  
  // Related data (populated via joins)
  phases?: WorkflowPhase[];
  projectCount?: number;
}

// Workflow phase structure
export interface WorkflowPhase {
  id: string;
  workflowTemplateId: string;
  name: string;
  description?: string;
  orderIndex: number;
  color: string;
  icon?: string;
  estimatedDuration?: number; // days
  requiredRoles: string[];
  dependencies: string[]; // phase IDs
  completionCriteria: string[];
  isOptional: boolean;
  isParallel: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  steps?: WorkflowStep[];
  template?: WorkflowTemplate;
}

// Workflow step structure
export interface WorkflowStep {
  id: string;
  workflowPhaseId: string;
  name: string;
  description?: string;
  orderIndex: number;
  stepType: StepType;
  estimatedDuration?: number; // hours
  assigneeRole?: string;
  assigneeId?: string;
  dependencies: string[]; // step IDs
  preconditions: string[];
  postconditions: string[];
  instructions?: string;
  resources: string[];
  validation: string[];
  isRequired: boolean;
  isAutomated: boolean;
  automationConfig?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  tasks?: WorkflowTask[];
  phase?: WorkflowPhase;
  assignee?: StaffMember;
}

// Workflow task structure
export interface WorkflowTask {
  id: string;
  workflowStepId: string;
  name: string;
  description?: string;
  orderIndex: number;
  priority: TaskPriority;
  estimatedHours?: number;
  skillsRequired: string[];
  tools: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  isOptional: boolean;
  canBeParallel: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  step?: WorkflowStep;
}

// Project workflow instance
export interface ProjectWorkflow {
  id: string;
  projectId: string;
  workflowTemplateId: string;
  name: string;
  status: ProjectWorkflowStatus;
  currentPhaseId?: string;
  progressPercentage: number;
  startDate?: string;
  plannedEndDate?: string;
  actualEndDate?: string;
  assignedTo?: string;
  teamMembers: string[];
  metrics: Record<string, unknown>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  project?: Project;
  template?: WorkflowTemplate;
  currentPhase?: WorkflowPhase;
  assignedUser?: StaffMember;
}

// Workflow execution log
export interface WorkflowExecutionLog {
  id: string;
  projectWorkflowId: string;
  phaseId?: string;
  stepId?: string;
  taskId?: string;
  action: WorkflowAction;
  actorId: string;
  actorName?: string;
  previousStatus?: string;
  newStatus?: string;
  duration?: number; // minutes
  notes?: string;
  attachments: string[];
  metadata: Record<string, unknown>;
  timestamp: string;
  
  // Related data
  projectWorkflow?: ProjectWorkflow;
  actor?: StaffMember;
}

// Supporting types
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
}

/** Project shape used within workflow module context */
export interface WorkflowProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  clientId?: string;
  projectManagerId?: string;
  startDate: string;
  endDate: string;
}

/** @deprecated Use WorkflowProject instead */
export type Project = WorkflowProject;

// API Request/Response types
export interface CreateWorkflowTemplateRequest {
  name: string;
  description?: string;
  category: WorkflowCategory;
  type?: WorkflowType;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowTemplateRequest extends Partial<CreateWorkflowTemplateRequest> {
  status?: WorkflowStatus;
  version?: string;
}

export interface CreateWorkflowPhaseRequest {
  workflowTemplateId: string;
  name: string;
  description?: string;
  orderIndex: number;
  color?: string;
  icon?: string;
  estimatedDuration?: number;
  requiredRoles?: string[];
  dependencies?: string[];
  completionCriteria?: string[];
  isOptional?: boolean;
  isParallel?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowPhaseRequest extends Partial<CreateWorkflowPhaseRequest> {}

export interface CreateWorkflowStepRequest {
  workflowPhaseId: string;
  name: string;
  description?: string;
  orderIndex: number;
  stepType?: StepType;
  estimatedDuration?: number;
  assigneeRole?: string;
  assigneeId?: string;
  dependencies?: string[];
  preconditions?: string[];
  postconditions?: string[];
  instructions?: string;
  resources?: string[];
  validation?: string[];
  isRequired?: boolean;
  isAutomated?: boolean;
  automationConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowStepRequest extends Partial<CreateWorkflowStepRequest> {}

export interface CreateWorkflowTaskRequest {
  workflowStepId: string;
  name: string;
  description?: string;
  orderIndex: number;
  priority?: TaskPriority;
  estimatedHours?: number;
  skillsRequired?: string[];
  tools?: string[];
  deliverables?: string[];
  acceptanceCriteria?: string[];
  isOptional?: boolean;
  canBeParallel?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowTaskRequest extends Partial<CreateWorkflowTaskRequest> {}

export interface CreateProjectWorkflowRequest {
  projectId: string;
  workflowTemplateId: string;
  name: string;
  startDate?: string;
  plannedEndDate?: string;
  assignedTo?: string;
  teamMembers?: string[];
  notes?: string;
}

export interface UpdateProjectWorkflowRequest extends Partial<CreateProjectWorkflowRequest> {
  status?: ProjectWorkflowStatus;
  currentPhaseId?: string;
  progressPercentage?: number;
  actualEndDate?: string;
  metrics?: Record<string, unknown>;
}

// Bulk operations
export interface BulkUpdateOrderRequest {
  items: Array<{
    id: string;
    orderIndex: number;
  }>;
}

export interface BulkDeleteRequest {
  ids: string[];
}

// Query and filter types
export interface WorkflowTemplateQuery {
  category?: WorkflowCategory;
  type?: WorkflowType;
  status?: WorkflowStatus;
  search?: string;
  tags?: string[];
  isDefault?: boolean;
  isSystem?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface ProjectWorkflowQuery {
  projectId?: string;
  templateId?: string;
  status?: ProjectWorkflowStatus;
  assignedTo?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowExecutionLogQuery {
  projectWorkflowId?: string;
  action?: WorkflowAction;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// Drag and Drop types
export interface DragItem {
  id: string;
  type: 'phase' | 'step' | 'task';
  orderIndex: number;
}

export interface DropResult {
  draggedId: string;
  targetId?: string;
  newOrderIndex: number;
  dropEffect: 'move' | 'copy';
}

// Template import/export types
export interface WorkflowTemplateExport {
  template: WorkflowTemplate;
  phases: WorkflowPhase[];
  steps: WorkflowStep[];
  tasks: WorkflowTask[];
  exportedAt: string;
  exportedBy: string;
  version: string;
}

export interface TemplateImportResult {
  success: boolean;
  templateId?: string;
  errors?: string[];
  warnings?: string[];
}

// Validation types
export interface WorkflowValidationResult {
  isValid: boolean;
  errors: WorkflowValidationError[];
  warnings: WorkflowValidationWarning[];
}

export interface WorkflowValidationError {
  type: 'missing_required' | 'invalid_dependency' | 'duplicate_order' | 'circular_dependency';
  level: 'template' | 'phase' | 'step' | 'task';
  itemId?: string;
  message: string;
  field?: string;
}

export interface WorkflowValidationWarning {
  type: 'performance' | 'best_practice' | 'incomplete_data';
  level: 'template' | 'phase' | 'step' | 'task';
  itemId?: string;
  message: string;
  suggestion?: string;
}

// Analytics and metrics types
export interface WorkflowAnalytics {
  templateUsage: {
    templateId: string;
    templateName: string;
    projectCount: number;
    averageDuration: number;
    successRate: number;
  }[];
  phaseMetrics: {
    phaseName: string;
    averageDuration: number;
    completionRate: number;
    bottleneckRisk: number;
  }[];
  performanceMetrics: {
    totalProjects: number;
    averageProjectDuration: number;
    onTimeCompletion: number;
    mostUsedTemplates: string[];
    commonBottlenecks: string[];
  };
}

// UI component props types
export interface WorkflowEditorProps {
  templateId?: string;
  onSave?: (template: WorkflowTemplate) => void;
  onCancel?: () => void;
  readonly?: boolean;
}

export interface PhaseManagerProps {
  workflowTemplateId: string;
  phases: WorkflowPhase[];
  onPhaseCreate?: (phase: CreateWorkflowPhaseRequest) => void;
  onPhaseUpdate?: (id: string, phase: UpdateWorkflowPhaseRequest) => void;
  onPhaseDelete?: (id: string) => void;
  onPhaseReorder?: (items: BulkUpdateOrderRequest) => void;
  readonly?: boolean;
}

export interface StepManagerProps {
  phaseId: string;
  steps: WorkflowStep[];
  onStepCreate?: (step: CreateWorkflowStepRequest) => void;
  onStepUpdate?: (id: string, step: UpdateWorkflowStepRequest) => void;
  onStepDelete?: (id: string) => void;
  onStepReorder?: (items: BulkUpdateOrderRequest) => void;
  readonly?: boolean;
}

export interface TaskManagerProps {
  stepId: string;
  tasks: WorkflowTask[];
  onTaskCreate?: (task: CreateWorkflowTaskRequest) => void;
  onTaskUpdate?: (id: string, task: UpdateWorkflowTaskRequest) => void;
  onTaskDelete?: (id: string) => void;
  onTaskReorder?: (items: BulkUpdateOrderRequest) => void;
  onBulkDelete?: (ids: string[]) => void;
  readonly?: boolean;
}

// State management types
export interface WorkflowState {
  templates: WorkflowTemplate[];
  currentTemplate?: WorkflowTemplate;
  phases: WorkflowPhase[];
  steps: WorkflowStep[];
  tasks: WorkflowTask[];
  projectWorkflows: ProjectWorkflow[];
  executionLogs: WorkflowExecutionLog[];
  loading: boolean;
  error?: string;
}

export interface WorkflowActions {
  // Template actions
  loadTemplates: (query?: WorkflowTemplateQuery) => Promise<WorkflowTemplate[]>;
  createTemplate: (template: CreateWorkflowTemplateRequest) => Promise<WorkflowTemplate>;
  updateTemplate: (id: string, template: UpdateWorkflowTemplateRequest) => Promise<WorkflowTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string, newName: string) => Promise<WorkflowTemplate>;
  
  // Phase actions
  loadPhases: (templateId: string) => Promise<WorkflowPhase[]>;
  createPhase: (phase: CreateWorkflowPhaseRequest) => Promise<WorkflowPhase>;
  updatePhase: (id: string, phase: UpdateWorkflowPhaseRequest) => Promise<WorkflowPhase>;
  deletePhase: (id: string) => Promise<void>;
  reorderPhases: (templateId: string, items: BulkUpdateOrderRequest) => Promise<void>;
  
  // Step actions
  loadSteps: (phaseId: string) => Promise<WorkflowStep[]>;
  createStep: (step: CreateWorkflowStepRequest) => Promise<WorkflowStep>;
  updateStep: (id: string, step: UpdateWorkflowStepRequest) => Promise<WorkflowStep>;
  deleteStep: (id: string) => Promise<void>;
  reorderSteps: (phaseId: string, items: BulkUpdateOrderRequest) => Promise<void>;
  
  // Task actions
  loadTasks: (stepId: string) => Promise<WorkflowTask[]>;
  createTask: (task: CreateWorkflowTaskRequest) => Promise<WorkflowTask>;
  updateTask: (id: string, task: UpdateWorkflowTaskRequest) => Promise<WorkflowTask>;
  deleteTask: (id: string) => Promise<void>;
  reorderTasks: (stepId: string, items: BulkUpdateOrderRequest) => Promise<void>;
  bulkDeleteTasks: (ids: string[]) => Promise<void>;
  
  // Project workflow actions
  loadProjectWorkflows: (query?: ProjectWorkflowQuery) => Promise<ProjectWorkflow[]>;
  createProjectWorkflow: (workflow: CreateProjectWorkflowRequest) => Promise<ProjectWorkflow>;
  updateProjectWorkflow: (id: string, workflow: UpdateProjectWorkflowRequest) => Promise<ProjectWorkflow>;
  deleteProjectWorkflow: (id: string) => Promise<void>;
  
  // Validation and analysis
  validateTemplate: (templateId: string) => Promise<WorkflowValidationResult>;
  getAnalytics: (dateFrom?: string, dateTo?: string) => Promise<WorkflowAnalytics>;
  
  // Import/Export
  exportTemplate: (templateId: string) => Promise<WorkflowTemplateExport>;
  importTemplate: (templateData: WorkflowTemplateExport) => Promise<TemplateImportResult>;
}