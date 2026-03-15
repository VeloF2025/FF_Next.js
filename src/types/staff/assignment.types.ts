/**
 * Staff Assignment Types - Project assignments and roles
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

export interface ProjectAssignment {
  id?: string;
  staffId: string;
  staffName: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  startDate: Timestamp;
  endDate?: Timestamp;
  allocation: number; // Percentage of time allocated (0-100)
  status: AssignmentStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum ProjectRole {
  PROJECT_MANAGER = 'project_manager',
  LEAD_ENGINEER = 'lead_engineer',
  SENIOR_TECHNICIAN = 'senior_technician',
  TECHNICIAN = 'technician',
  INSTALLER = 'installer',
  QUALITY_INSPECTOR = 'quality_inspector',
  SUPPORT = 'support',
  COORDINATOR = 'coordinator',
}

export enum AssignmentStatus {
  ASSIGNED = 'assigned',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ON_HOLD = 'on_hold',
}