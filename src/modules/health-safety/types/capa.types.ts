/**
 * CAPA (Corrective & Preventive Actions) Types
 *
 * Central workflow used by incidents, audits, risk assessments, and permits.
 */

export type CAPASourceType = 'audit' | 'incident' | 'observation' | 'risk' | 'permit';
export type CAPASeverity = 'critical' | 'high' | 'medium' | 'low';
export type CAPAStatus = 'open' | 'in_progress' | 'verification' | 'closed' | 'overdue';
export type RootCauseMethod = 'five_whys' | 'fishbone' | 'fault_tree' | 'other';
export type VerificationOutcome = 'accepted' | 'rejected' | 'rework_needed';

export interface CAPA {
  id: string;
  source_type: CAPASourceType;
  source_id: string | null;
  project_id: string | null;
  contractor_id: string | null;
  title: string;
  description: string | null;
  severity: CAPASeverity;
  status: CAPAStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  due_date: string;
  completed_at: string | null;
  completed_by: string | null;
  completion_notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  verification_outcome: VerificationOutcome | null;
  root_cause_method: RootCauseMethod | null;
  root_cause_analysis: RootCauseEntry[];
  preventive_actions: string | null;
  evidence_photos: { url: string; caption?: string }[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RootCauseEntry {
  step: number;
  question: string;
  answer: string;
}

export interface CAPAComment {
  id: string;
  capa_id: string;
  author_id: string | null;
  author_name?: string;
  comment: string;
  created_at: string;
}

export interface CAPAInput {
  source_type: CAPASourceType;
  source_id?: string;
  project_id?: string;
  contractor_id?: string;
  title: string;
  description?: string;
  severity?: CAPASeverity;
  assigned_to?: string;
  due_date: string;
  root_cause_method?: RootCauseMethod;
  root_cause_analysis?: RootCauseEntry[];
  preventive_actions?: string;
  evidence_photos?: { url: string; caption?: string }[];
}

export interface CAPASummary {
  id: string;
  title: string;
  severity: CAPASeverity;
  status: CAPAStatus;
  source_type: CAPASourceType;
  project_name: string | null;
  contractor_name: string | null;
  assigned_to_name: string | null;
  due_date: string;
  created_at: string;
  is_overdue: boolean;
}

// Status transition rules
export const CAPA_STATUS_TRANSITIONS: Record<CAPAStatus, CAPAStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['verification', 'closed'],
  verification: ['closed', 'in_progress'], // rejected → back to in_progress
  closed: [],
  overdue: ['in_progress', 'closed'],
};

export const CAPA_SEVERITY_CONFIG: Record<CAPASeverity, {
  label: string;
  color: string;
  defaultDueDays: number;
}> = {
  critical: { label: 'Critical', color: 'red', defaultDueDays: 3 },
  high: { label: 'High', color: 'orange', defaultDueDays: 7 },
  medium: { label: 'Medium', color: 'yellow', defaultDueDays: 14 },
  low: { label: 'Low', color: 'blue', defaultDueDays: 30 },
};

export const CAPA_STATUS_CONFIG: Record<CAPAStatus, {
  label: string;
  color: string;
}> = {
  open: { label: 'Open', color: 'blue' },
  in_progress: { label: 'In Progress', color: 'amber' },
  verification: { label: 'Awaiting Verification', color: 'purple' },
  closed: { label: 'Closed', color: 'green' },
  overdue: { label: 'Overdue', color: 'red' },
};
