/**
 * H&S Permit to Work types + lifecycle state machine (goal Phase 4, §7.4)
 */

export type PermitStatus = 'requested' | 'approved' | 'active' | 'closed' | 'expired' | 'rejected';

/**
 * Server-enforced lifecycle. `expired` is reached automatically (by the validity
 * window lapsing), never via a client-requested transition, so it is not a
 * target here. closed/expired/rejected are terminal.
 */
export const PERMIT_STATUS_TRANSITIONS: Record<PermitStatus, PermitStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['active', 'closed'],
  active: ['closed'],
  closed: [],
  expired: [],
  rejected: [],
};

export const PERMIT_STATUS_CONFIG: Record<PermitStatus, { label: string; color: string }> = {
  requested: { label: 'Requested', color: 'gray' },
  approved: { label: 'Approved', color: 'blue' },
  active: { label: 'Active', color: 'green' },
  closed: { label: 'Closed', color: 'gray' },
  expired: { label: 'Expired', color: 'red' },
  rejected: { label: 'Rejected', color: 'red' },
};

export interface PermitPrecondition {
  text: string;
  required: boolean;
}

export interface PermitType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  preconditions: PermitPrecondition[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Permit {
  id: string;
  permit_type_id: string;
  permit_number: string;
  project_id: string | null;
  title: string;
  work_description: string | null;
  location: string | null;
  status: PermitStatus;
  valid_from: string | null;
  valid_to: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** which precondition texts have been confirmed */
  precondition_confirmed: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}
