export type AssignmentKind = 'roster' | 'daily_override';
export type AssignmentSource = AssignmentKind | 'vehicle_project' | 'home_site' | 'unassigned';
export type ConflictLevel = 'blocking' | 'warning';

export interface AssignmentProposalRow {
  staffId: string;
  projectId: string;
  operationalSiteId: string;
  startDate: string;
  endDate: string;
  assignmentKind: AssignmentKind;
  vehicleAssignmentId: string | null;
  reason: string | null;
}

export interface ProposalConflict {
  rowIndex: number;
  code: string;
  level: ConflictLevel;
  field: keyof AssignmentProposalRow | null;
  message: string;
}

export interface PreviewResult {
  normalizedRows: AssignmentProposalRow[];
  conflicts: ProposalConflict[];
  fingerprint: string;
  sourceVersion: string;
}

export interface OperationalSite {
  id: string;
  projectId: string;
  displayName: string;
  projectAoiId: string | null;
  authorizedLocationId: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface AssignmentRosterEntry {
  assignmentId: string | null;
  staffId: string;
  projectId: string | null;
  operationalSiteId: string | null;
  source: AssignmentSource;
  startDate: string | null;
  endDate: string | null;
  vehicleAssignmentId: string | null;
}

export interface ResolvedOperationalAssignment {
  staffId: string;
  workDate: string;
  source: AssignmentSource;
  projectId: string | null;
  projectManager: string | null;
  operationalSiteId: string | null;
  operationalSiteName: string | null;
  authorizedLocationId: string | null;
  vehicleAssignmentId: string | null;
  scheduled: boolean;
  expectedStartTime: string | null;
  expectedEndTime: string | null;
  schedulePolicyId: string | null;
  warnings: string[];
  sourceRowIds: string[];
}
