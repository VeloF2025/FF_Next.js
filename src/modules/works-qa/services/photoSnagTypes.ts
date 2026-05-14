// Shared types for the photo-snag flow.

export type SnagSeverity = 'minor' | 'major' | 'critical';

export interface SlotApproval {
  decision: 'approved' | 'snagged';
  by: string;            // user UUID
  at: string;            // ISO timestamp
  snag_id?: string;      // present when decision='snagged'
}

export type SlotApprovals = Record<string, SlotApproval>;

export interface PhotoSnagRow {
  id: string;
  pole_qa_photo_id: string;
  slot_key: string;
  slot_photo_key: string | null;
  discipline: 'civil' | 'dome' | 'main_joint';
  description: string;
  severity: SnagSeverity;
  status: string;
  noc_ticket_id: string | null;
  assigned_to: string | null;
  created_at: Date;
}

export interface PhotoSnagListItem extends PhotoSnagRow {
  ticket_uid: string | null;
  assignee_name: string | null;
  pole_label: string;
}

export interface CreatePhotoSnagInput {
  poleQaPhotoId: string;
  slotKey: string;
  comment: string;
  severity?: SnagSeverity;
  // MUST be a valid users.id (not staff.id). PR2's API route is responsible
  // for resolving any staff/team lookup to a users.id before calling.
  assignedToUserId?: string;
  createdBy: string;
}

import type { Ticket } from '@/modules/noc/types/ticket';

export interface CreatePhotoSnagResult {
  status: 'created' | 'duplicate';
  snag: PhotoSnagRow;
  ticket?: Ticket;
  slotApprovals: SlotApprovals;
}

export interface ResolvePhotoSnagInput {
  snagId: string;
  resolvedBy: string;
  resolutionNote?: string;
  closeTicket: boolean;
}

export interface PoleSnagReport {
  pole: { id: string; pole_label: string; zone_no: number | null; pon_no: number | null; project_id: string };
  totals: { total: number; approved: number; snagged: number; pending: number };
  snags: PhotoSnagListItem[];
  report_id: string;
  generated_at: string;
}
