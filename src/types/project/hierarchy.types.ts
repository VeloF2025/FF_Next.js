/**
 * Project hierarchy types - Phase, Step, Task
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import { Priority } from './base.types';

// Re-export Priority for convenience
export { Priority };

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  type?: PhaseType;
  order: number;
  status: PhaseStatus;
  progress: number;
  plannedStartDate?: Date | Timestamp | string;
  plannedEndDate?: Date | Timestamp | string;
  actualStartDate?: Date | Timestamp | string;
  actualEndDate?: Date | Timestamp | string;
  dependencies?: string[];
  milestones?: string[];
  assignedTo?: string[];
  budget?: number;
  actualCost?: number;
  notes?: string;
  createdAt: Date | Timestamp | string;
  updatedAt?: Date | Timestamp | string;
}

export interface Step {
  id: string;
  phaseId: string;
  name: string;
  description?: string;
  order: number;
  status: StepStatus;
  progress: number;
  plannedDuration?: number; // in hours
  actualDuration?: number;
  startDate?: Date | Timestamp | string;
  endDate?: Date | Timestamp | string;
  assignedTo?: string[];
  dependencies?: string[];
  checklist?: ChecklistItem[];
  resources?: string[];
  notes?: string;
  createdAt: Date | Timestamp | string;
  updatedAt?: Date | Timestamp | string;
}

export interface Task {
  id: string;
  stepId: string;
  name: string;
  description?: string;
  order: number;
  status: TaskStatus;
  priority: Priority;
  progress: number;
  estimatedHours?: number;
  actualHours?: number;
  startDate?: Date | Timestamp | string;
  dueDate?: Date | Timestamp | string;
  completedDate?: Date | Timestamp | string;
  assignedTo?: string;
  assignedToName?: string;
  checklist?: ChecklistItem[];
  attachments?: string[];
  comments?: TaskComment[];
  tags?: string[];
  isBlocked?: boolean;
  blockReason?: string;
  dependencies?: string[];
  createdBy: string;
  createdAt: Date | Timestamp | string;
  updatedBy?: string;
  updatedAt?: Date | Timestamp | string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: Date | Timestamp | string;
}

export interface TaskComment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Date | Timestamp | string;
}

// Enums
export enum PhaseType {
  PLANNING = 'planning',
  DESIGN = 'design',
  PROCUREMENT = 'procurement',
  CONSTRUCTION = 'construction',
  TESTING = 'testing',
  COMMISSIONING = 'commissioning',
  HANDOVER = 'handover',
  MAINTENANCE = 'maintenance'
}

export enum PhaseStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled'
}

export enum StepStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
  SKIPPED = 'skipped',
  ON_HOLD = 'on_hold'
}

export enum TaskStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
  CANCELLED = 'cancelled',
  DEFERRED = 'deferred'
}

// Hierarchy interfaces
export interface ProjectHierarchy {
  project: any; // Using any to avoid circular dependency
  phases: PhaseHierarchy[];
}

export interface PhaseHierarchy extends Phase {
  startDate?: Date | Timestamp | string;
  endDate?: Date | Timestamp | string;
  tasks?: Task[];
  steps?: StepHierarchy[];
}

export interface StepHierarchy extends Step {
  tasks?: Task[];
}