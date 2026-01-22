/**
 * H&S Audit Types
 *
 * Types for project H&S configuration, audits, and responses.
 */

import type { ChecklistCategory, HSChecklistItem } from './checklist.types';

export type AuditFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'custom';
export type AuditType = 'routine' | 'spot_check' | 'follow_up' | 'incident_triggered' | 'pre_work';
export type AuditStatus = 'in_progress' | 'completed' | 'requires_action' | 'cancelled';
export type ResponseValue = 'pass' | 'fail' | 'na' | 'not_checked';
export type RAGStatus = 'red' | 'amber' | 'green';

// Photo attachment structure
export interface AuditPhoto {
  url: string;
  caption?: string;
  timestamp: string;
  category?: ChecklistCategory;
}

// Project H&S Configuration
export interface HSProjectConfig {
  id: string;
  project_id: string;
  template_id: string | null;
  audit_frequency: AuditFrequency;
  custom_frequency_days: number | null;
  next_audit_due: string | null;
  min_score_threshold: number;
  requires_daily_briefing: boolean;
  height_work_permitted: boolean;
  hot_work_permitted: boolean;
  confined_space_work: boolean;
  excavation_work: boolean;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  // Joined data
  template?: { id: string; name: string };
  project?: { id: string; project_name: string };
}

export interface HSProjectConfigInput {
  project_id: string;
  template_id?: string;
  audit_frequency?: AuditFrequency;
  custom_frequency_days?: number;
  min_score_threshold?: number;
  requires_daily_briefing?: boolean;
  height_work_permitted?: boolean;
  hot_work_permitted?: boolean;
  confined_space_work?: boolean;
  excavation_work?: boolean;
  notes?: string;
}

// Project Audit
export interface HSProjectAudit {
  id: string;
  project_id: string;
  auditor_id: number | null;
  audit_date: string;
  audit_type: AuditType;
  overall_score: number | null;
  rag_status: RAGStatus | null;
  status: AuditStatus;
  notes: string | null;
  photos: AuditPhoto[];
  weather_conditions: string | null;
  site_personnel_count: number | null;
  completed_at: string | null;
  created_at: string;
  // Joined data
  auditor?: { id: number; full_name: string };
  project?: { id: string; project_name: string };
  responses?: HSAuditResponse[];
  response_summary?: {
    total: number;
    passed: number;
    failed: number;
    na: number;
    not_checked: number;
  };
}

export interface HSProjectAuditInput {
  project_id: string;
  auditor_id?: number;
  audit_date?: string;
  audit_type?: AuditType;
  notes?: string;
  weather_conditions?: string;
  site_personnel_count?: number;
}

// Audit Response (individual checklist answer)
export interface HSAuditResponse {
  id: string;
  audit_id: string;
  checklist_item_id: string | null;
  response: ResponseValue;
  notes: string | null;
  photo_url: string | null;
  corrective_action_required: boolean;
  ticket_created: boolean;
  ticket_id: string | null;
  created_at: string;
  // Joined data
  checklist_item?: HSChecklistItem;
}

export interface HSAuditResponseInput {
  audit_id: string;
  checklist_item_id: string;
  response: ResponseValue;
  notes?: string;
  photo_url?: string;
  corrective_action_required?: boolean;
}

// Audit summary for dashboard/list views
export interface AuditSummary {
  id: string;
  project_id: string;
  project_name: string;
  audit_date: string;
  audit_type: AuditType;
  auditor_name: string | null;
  overall_score: number | null;
  rag_status: RAGStatus | null;
  status: AuditStatus;
  items_checked: number;
  items_failed: number;
  corrective_actions_needed: number;
}

// Audit configuration for starting a new audit
export interface AuditConfig {
  project_id: string;
  template_id: string;
  auditor_id: number;
  audit_type: AuditType;
  items: HSChecklistItem[];
}

// Audit result calculation
export interface AuditScoreResult {
  overall_score: number;
  rag_status: RAGStatus;
  category_scores: Record<ChecklistCategory, { score: number; total: number; passed: number }>;
  critical_failures: HSAuditResponse[];
  requires_action: boolean;
}

// RAG thresholds
export const RAG_THRESHOLDS = {
  red: { max: 49, label: 'Fail', color: '#ef4444' },
  amber: { min: 50, max: 79, label: 'Needs Improvement', color: '#f59e0b' },
  green: { min: 80, label: 'Pass', color: '#22c55e' },
} as const;

export function getRAGStatus(score: number): RAGStatus {
  if (score < 50) return 'red';
  if (score < 80) return 'amber';
  return 'green';
}

export const AUDIT_TYPE_CONFIG: Record<AuditType, { label: string; icon: string }> = {
  routine: { label: 'Routine Audit', icon: 'Calendar' },
  spot_check: { label: 'Spot Check', icon: 'Eye' },
  follow_up: { label: 'Follow-up Audit', icon: 'RefreshCw' },
  incident_triggered: { label: 'Incident Triggered', icon: 'AlertTriangle' },
  pre_work: { label: 'Pre-Work Inspection', icon: 'ClipboardCheck' },
};

export const AUDIT_STATUS_CONFIG: Record<
  AuditStatus,
  { label: string; color: string; icon: string }
> = {
  in_progress: { label: 'In Progress', color: 'blue', icon: 'Clock' },
  completed: { label: 'Completed', color: 'green', icon: 'CheckCircle' },
  requires_action: { label: 'Requires Action', color: 'orange', icon: 'AlertCircle' },
  cancelled: { label: 'Cancelled', color: 'gray', icon: 'XCircle' },
};

export const FREQUENCY_OPTIONS: { value: AuditFrequency; label: string; days: number }[] = [
  { value: 'daily', label: 'Daily', days: 1 },
  { value: 'weekly', label: 'Weekly', days: 7 },
  { value: 'fortnightly', label: 'Fortnightly', days: 14 },
  { value: 'monthly', label: 'Monthly', days: 30 },
  { value: 'custom', label: 'Custom', days: 0 },
];
