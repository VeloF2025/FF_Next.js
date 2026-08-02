export type AdjustmentKind =
  | 'forgot_clock_out'
  | 'wrong_clock_in_time'
  | 'wrong_clock_out_time'
  | 'wrong_site'
  | 'duplicate_entry'
  | 'other';

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AdjustmentRow extends Record<string, unknown> {
  id: string;
  entry_id: string;
  requested_by: string;
  adjustment_kind: AdjustmentKind;
  adjusted_clock_in_at: string | null;
  adjusted_clock_out_at: string | null;
  adjusted_site_geofence_id: string | null;
  reason: string;
  status: AdjustmentStatus;
  reviewed_by: string | null;
  cancelled_by_staff_id?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  entry_staff_id?: string;
  entry_work_date?: string;
  entry_clock_in_at?: string;
  entry_clock_out_at?: string | null;
  staff_full_name?: string;
}

export interface OwnAdjustmentStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface AdjustmentWithEntry {
  dayExceptionId?: string | null;
  adjustment: AdjustmentRow;
  entry: {
    id: string;
    staff_id: string;
    work_date: string;
    clock_in_at: string;
    clock_out_at: string | null;
    status: string;
  };
}
