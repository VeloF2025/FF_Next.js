/**
 * Disciplinary Types - Staff disciplinary incidents and warnings
 * Part of HR System Expansion
 */

/**
 * Types of disciplinary actions
 * Follows progressive discipline approach
 */
export type DisciplinaryType =
  | 'verbal_warning'
  | 'written_warning'
  | 'final_warning'
  | 'suspension'
  | 'dismissal'
  | 'counseling'
  | 'performance_improvement_plan';

/**
 * Outcome of a disciplinary action
 */
export type DisciplinaryOutcome =
  | 'acknowledged'
  | 'disputed'
  | 'appealed'
  | 'overturned'
  | 'upheld'
  | 'expired'
  | 'pending';

/**
 * Attachment for disciplinary incident
 */
export interface DisciplinaryAttachment {
  url: string;
  filename: string;
  uploadedAt: string;
  mimeType?: string;
  size?: number;
}

/**
 * Disciplinary incident record
 */
export interface DisciplinaryIncident {
  id: string;
  staffId: string;
  incidentDate: string;
  incidentType: DisciplinaryType;
  description: string;
  outcome?: DisciplinaryOutcome;
  issuedBy?: string;
  witnessIds: string[];
  followUpDate?: string;
  followUpNotes?: string;
  isResolved: boolean;
  resolvedDate?: string;
  attachments: DisciplinaryAttachment[];
  createdAt: string;
  updatedAt: string;
  // Joined data
  issuedByStaff?: {
    id: string;
    name: string;
    position?: string;
  };
  witnesses?: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Create disciplinary incident payload
 */
export interface DisciplinaryIncidentCreate {
  staffId: string;
  incidentDate: string;
  incidentType: DisciplinaryType;
  description: string;
  outcome?: DisciplinaryOutcome;
  issuedBy?: string;
  witnessIds?: string[];
  followUpDate?: string;
  followUpNotes?: string;
  attachments?: DisciplinaryAttachment[];
}

/**
 * Update disciplinary incident payload
 */
export interface DisciplinaryIncidentUpdate {
  incidentDate?: string;
  incidentType?: DisciplinaryType;
  description?: string;
  outcome?: DisciplinaryOutcome;
  issuedBy?: string;
  witnessIds?: string[];
  followUpDate?: string;
  followUpNotes?: string;
  isResolved?: boolean;
  resolvedDate?: string;
  attachments?: DisciplinaryAttachment[];
}

/**
 * Labels for disciplinary types
 */
export const DISCIPLINARY_TYPE_LABELS: Record<DisciplinaryType, string> = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  final_warning: 'Final Written Warning',
  suspension: 'Suspension',
  dismissal: 'Dismissal',
  counseling: 'Counseling Session',
  performance_improvement_plan: 'Performance Improvement Plan (PIP)',
};

/**
 * Labels for disciplinary outcomes
 */
export const DISCIPLINARY_OUTCOME_LABELS: Record<DisciplinaryOutcome, string> = {
  acknowledged: 'Acknowledged',
  disputed: 'Disputed',
  appealed: 'Appealed',
  overturned: 'Overturned',
  upheld: 'Upheld',
  expired: 'Expired',
  pending: 'Pending',
};

/**
 * Severity levels for disciplinary types (for sorting/display)
 */
export const DISCIPLINARY_SEVERITY: Record<DisciplinaryType, number> = {
  counseling: 1,
  verbal_warning: 2,
  written_warning: 3,
  performance_improvement_plan: 4,
  final_warning: 5,
  suspension: 6,
  dismissal: 7,
};

/**
 * Colors for disciplinary types (for badges)
 */
export const DISCIPLINARY_TYPE_COLORS: Record<DisciplinaryType, string> = {
  verbal_warning: 'yellow',
  written_warning: 'orange',
  final_warning: 'red',
  suspension: 'red',
  dismissal: 'red',
  counseling: 'blue',
  performance_improvement_plan: 'purple',
};

/**
 * Colors for disciplinary outcomes
 */
export const DISCIPLINARY_OUTCOME_COLORS: Record<DisciplinaryOutcome, string> = {
  acknowledged: 'green',
  disputed: 'orange',
  appealed: 'yellow',
  overturned: 'blue',
  upheld: 'gray',
  expired: 'gray',
  pending: 'yellow',
};
