/**
 * Staff Timesheet Types - Time tracking and work records
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

export interface Timesheet {
  id?: string;
  staffId: string;
  staffName: string;
  projectId?: string;
  projectName?: string;
  date: Timestamp;
  hoursWorked: number;
  workType: WorkType;
  description: string;
  location?: string;
  approvedBy?: string;
  approvedDate?: Timestamp;
  status: TimesheetStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum WorkType {
  REGULAR = 'regular',
  OVERTIME = 'overtime',
  WEEKEND = 'weekend',
  NIGHT_SHIFT = 'night_shift',
  TRAINING = 'training',
  MEETING = 'meeting',
  TRAVEL = 'travel',
  ADMIN = 'admin',
}

export enum TimesheetStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}