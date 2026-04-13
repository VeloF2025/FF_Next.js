/**
 * Project Form Types
 * Types for project creation and update forms
 */

import { ProjectPriority, ProjectStatus } from './enums';
import type { ProjectLocation, ProjectBudget } from './core.types';

export interface CreateProjectRequest {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  durationMonths?: number; // Duration in months for automatic end date calculation
  location: ProjectLocation;
  clientId: string;
  projectManagerId: string;
  priority: ProjectPriority;
  budget?: Partial<ProjectBudget>;
  teamMembers?: string[]; // Staff IDs
  metadata?: Record<string, unknown>;
  notes?: string; // Additional notes field
}

export interface UpdateProjectRequest extends Partial<CreateProjectRequest> {
  id: string;
  status?: ProjectStatus;
}