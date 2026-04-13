/**
 * Core Project Types
 * Main project entity and related core types
 */

import { 
  ProjectStatus, 
  ProjectPriority, 
  SOWDocumentType, 
  DocumentStatus,
  TaskStatus
} from './enums';

export interface ProjectLocation {
  address: string;
  city: string;
  province: string;
  postalCode: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  region?: string; // Cape Town, Johannesburg, etc.
}

export interface ProjectTeamMember {
  id?: string;
  staffId: string;
  name: string;
  role: string;
  position: string;
  email?: string;
  phone?: string;
  assignedDate: string;
  isActive: boolean;
  isLead?: boolean;
}

export interface SOWDocument {
  id: string;
  name: string;
  type: SOWDocumentType;
  fileUrl: string;
  uploadDate: string;
  uploadedBy: string;
  version: number;
  status: DocumentStatus;
  metadata?: {
    poleCount?: number;
    dropCount?: number;
    cableLength?: number;
    trenchLength?: number;
    estimatedCost?: number;
  };
}

export interface ProjectDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  size?: number;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  
  // Dates
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  
  // Location & Client
  location: ProjectLocation;
  clientId: string;
  clientName?: string; // Populated from client data
  
  // Team & Resources
  projectManagerId: string;
  projectManagerName?: string; // Populated from staff data
  teamMembers: ProjectTeamMember[];
  
  // Progress & Metrics
  progress: ProjectProgress;
  plannedProgress?: number;
  actualProgress?: number;
  schedulePerformance?: number;
  costPerformance?: number;
  qualityScore?: number;
  budget: ProjectBudget;
  actualCost?: number;
  
  // Project Management
  phase?: string;
  milestones?: ProjectMilestone[];
  risks?: ProjectRisk[];
  
  // SOW & Documentation
  sowDocuments: SOWDocument[];
  documents?: ProjectDocument[];
  
  // Updates & Activity
  updates?: ProjectUpdate[];
  
  // Custom Fields
  metadata?: Record<string, unknown>;
}

// Forward declarations for types defined in other modules
export interface ProjectProgress {
  overallPercentage: number;
  tasksCompleted: number;
  totalTasks: number;
  phases: ProjectPhase[];
  polesInstalled: number;
  totalPoles: number;
  dropsCompleted: number;
  totalDrops: number;
  fibreCableInstalled: number;
  totalFibreCableRequired: number;
}

export interface ProjectBudget {
  totalBudget: number;
  allocatedBudget: number;
  spentAmount: number;
  remainingBudget: number;
  currency: string;
  categories: BudgetCategory[];
}

export interface ProjectMilestone {
  id: string;
  name: string;
  description?: string;
  dueDate: string;
  completedDate?: string;
  completed?: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'delayed';
  progress: number;
}

export interface ProjectRisk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  likelihood: 'low' | 'medium' | 'high';
  impact: string;
  mitigation?: string;
  status: 'identified' | 'mitigated' | 'resolved' | 'active';
  owner?: string;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  title: string;
  description: string;
  message?: string;
  type: 'progress' | 'milestone' | 'issue' | 'change' | 'general';
  author?: string;
  date?: string;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
}

export interface ProjectPhase {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  progress: number;
  tasks: PhaseTask[];
}

export interface PhaseTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedTo?: string;
  assignedToName?: string;
  dueDate?: string;
  completedDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  dependencies?: string[];
}

export interface BudgetCategory {
  id: string;
  name: string;
  allocatedAmount: number;
  spentAmount: number;
  description?: string;
}