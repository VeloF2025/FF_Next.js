/**
 * Form and filter types for projects
 */

import { ProjectStatus, ProjectType, Priority } from './base.types';

export interface ProjectFormData {
  name: string;
  code: string;
  description?: string;
  projectType: ProjectType;
  clientId?: string;
  location?: string;
  startDate: string;
  endDate: string;
  status?: ProjectStatus;
  priority?: Priority;
  budget?: number;
  projectManagerId?: string;
  teamMembers?: string[];
  contractorId?: string;
  milestones?: Record<string, unknown>[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProjectFilter {
  status?: ProjectStatus[];
  projectType?: ProjectType[];
  clientId?: string[];
  projectManagerId?: string;
  priority?: Priority[];
  dateRange?: {
    startDate?: Date;
    endDate?: Date;
  };
  budgetRange?: {
    min: number;
    max: number;
  };
  progressRange?: {
    min: number;
    max: number;
  };
  tags?: string[];
  search?: string;
}

export interface ProjectSummary {
  total: number;
  active: number;
  completed: number;
  onHold: number;
  totalBudget: number;
  totalSpent: number;
  averageProgress: number;
}

export interface ProjectSearch {
  query: string;
  filters?: ProjectFilter;
  sortBy?: 'name' | 'startDate' | 'endDate' | 'status' | 'progress' | 'budget';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ProjectExport {
  projects: string[]; // project IDs
  format: 'csv' | 'excel' | 'pdf' | 'json';
  fields?: string[]; // specific fields to export
  includeHierarchy?: boolean;
  includeAttachments?: boolean;
}