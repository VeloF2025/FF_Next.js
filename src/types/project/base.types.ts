/**
 * Base project types and interfaces
 */

import { Timestamp } from 'firebase/firestore';

export interface Project {
  id: string;
  name: string;
  project_name?: string; // Database field for compatibility
  code: string;
  project_code?: string; // Database field for compatibility
  client_name?: string; // Database field for compatibility
  description?: string;
  projectType: ProjectType;
  clientId?: string;
  clientName?: string;
  contractNumber?: string;
  sowNumber?: string;
  location?: string;
  region?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  startDate: Date | Timestamp | string;
  endDate: Date | Timestamp | string;
  actualStartDate?: Date | Timestamp | string;
  actualEndDate?: Date | Timestamp | string;
  status: ProjectStatus;
  priority: Priority;
  phase?: string;
  budget?: number;
  actualCost?: number;
  currency?: string;
  plannedProgress: number;
  actualProgress: number;
  projectManagerId?: string;
  projectManager?: string;
  projectManagerName?: string;
  teamLeadId?: string;
  teamLead?: string;
  teamMembers?: TeamMember[];
  contractorId?: string;
  contractorName?: string;
  subcontractors?: Subcontractor[];
  milestones?: Milestone[];
  deliverables?: Deliverable[];
  risks?: string[];
  dependencies?: string[];
  kpiTargets?: any; // TODO: Import ProjectKPITargets from kpi.types
  metadata?: ProjectMetadata;
  tags?: string[];
  attachments?: Attachment[];
  documents?: ProjectDocument[];
  comments?: Comment[];
  createdBy: string;
  createdAt: Date | Timestamp | string;
  updatedBy?: string;
  updatedAt?: Date | Timestamp | string;
  completedAt?: Date | Timestamp | string;
  isActive?: boolean;
  isArchived?: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  department?: string;
  isLead?: boolean;
  joinedDate?: Date | string;
  allocation?: number; // percentage
}

export interface Subcontractor {
  id: string;
  name: string;
  company: string;
  role: string;
  contact?: string;
  email?: string;
  phone?: string;
}

export interface Milestone {
  id?: string;
  name: string;
  description?: string;
  dueDate: Date | string;
  completed: boolean;
  completedDate?: Date | string;
  deliverables?: string[];
}

export interface Deliverable {
  id?: string;
  name: string;
  description?: string;
  type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'approved';
  dueDate?: Date | string;
  submittedDate?: Date | string;
  approvedDate?: Date | string;
  approvedBy?: string;
  url?: string;
}

export interface ProjectDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  size?: number;
  uploadedAt: Date | string;
  uploadedBy?: string;
}

export interface ProjectMetadata {
  version?: string;
  templateUsed?: string;
  importedFrom?: string;
  exportedTo?: string;
  lastSyncDate?: Date | Timestamp | string;
  customFields?: Record<string, any>;
}

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date | Timestamp | string;
  uploadedBy: string;
  category?: string;
  description?: string;
}

export interface Comment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Date | Timestamp | string;
  updatedAt?: Date | Timestamp | string;
  parentId?: string; // for nested comments
  mentions?: string[];
  attachments?: string[];
}

// Enums
export enum ProjectStatus {
  PLANNING = 'planning',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export enum ProjectType {
  FIBRE = 'fibre',
  NETWORK = 'network',
  INFRASTRUCTURE = 'infrastructure',
  MAINTENANCE = 'maintenance',
  SURVEY = 'survey',
  INSTALLATION = 'installation',
  OTHER = 'other'
}

export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}