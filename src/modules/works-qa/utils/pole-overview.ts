// Derives the PON-overview row (per-slot dot states, status, photo counts) from
// the compact fields returned by pages/api/works-qa/poles.ts. Kept as a pure,
// unit-tested function so the dot/status logic is verifiable without a DB — the
// raw jsonb (vlm_results/slot_approvals) is reduced to bounded arrays in SQL to
// keep the 30s-polled payload small (see poles.ts).
import { SLOT_META, type Discipline } from './slot-keys';
import type { PoleSummary, SlotApproval, SlotState } from '../types/works-qa.types';

/** Compact row shape selected by poles.ts before per-slot derivation. */
export interface PoleOverviewRow {
  id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  approved_at: string | null;
  tray_count: number;
  unassigned_count: number;
  outstanding_snag_count: number;
  has_open_verification_snag: boolean;
  has_verified_planted: boolean;
  /** Slot keys (SLOT_META.key) that currently have a photo. */
  present_slots: string[];
  /** Slot keys with an un-overridden VLM failure. */
  vlm_fail_keys: string[];
  /** Per-slot human Approve/Snag decisions (migration 247); may be null. */
  slot_approvals: Record<string, SlotApproval> | null;
  /** QField civil-audit Status (poles.field_status); optional, display-only. */
  field_status?: string | null;
}

function deriveSlotState(
  slotKey: string,
  present: Set<string>,
  vlmFails: Set<string>,
  approvals: Record<string, SlotApproval>,
): SlotState {
  if (!present.has(slotKey)) return 'empty';
  const decision = approvals[slotKey]?.decision;
  if (decision === 'approved') return 'approved';
  if (decision === 'snagged') return 'fail';
  if (vlmFails.has(slotKey)) return 'fail';
  return 'pass';
}

export function computePoleSummary(row: PoleOverviewRow): PoleSummary {
  const present = new Set(row.present_slots ?? []);
  const vlmFails = new Set(row.vlm_fail_keys ?? []);
  const approvals = row.slot_approvals ?? {};

  const statesFor = (d: Discipline): SlotState[] =>
    SLOT_META.filter(s => s.discipline === d).map(s =>
      deriveSlotState(s.key, present, vlmFails, approvals),
    );

  const civil_slots = statesFor('civil');
  const dome_slots = statesFor('dome');
  const joint_slots = statesFor('main_joint');

  const civil_filled = civil_slots.filter(s => s !== 'empty').length;
  const dome_filled = dome_slots.filter(s => s !== 'empty').length;
  const joint_filled = joint_slots.filter(s => s !== 'empty').length;

  const vlm_failures = vlmFails.size;
  const total_photos = civil_filled + dome_filled + joint_filled + row.tray_count + row.unassigned_count;

  return {
    id: row.id,
    pole_label: row.pole_label,
    zone_no: row.zone_no,
    pon_no: row.pon_no,
    civil_filled,
    dome_filled,
    joint_filled,
    tray_count: row.tray_count,
    vlm_failures,
    civil_slots,
    dome_slots,
    joint_slots,
    total_photos,
    unassigned_count: row.unassigned_count,
    status: deriveStatus(row, present, vlm_failures),
    approved_at: row.approved_at,
    outstanding_snag_count: row.outstanding_snag_count,
    has_open_verification_snag: row.has_open_verification_snag,
    has_verified_planted: row.has_verified_planted,
    has_photos: true,
    field_status: row.field_status ?? null,
  };
}

/**
 * Builds the PON-overview row for a pole that is field-confirmed planted
 * (poles.field_status, from the QField civil-audit) but has no pole_qa_photos
 * record yet — i.e. built in the field but not yet captured for QA. These rows
 * carry no dots/snags/approval and are non-interactive in the table; they exist
 * so the planted→QA'd gap is visible instead of silently dropped (Phase 2 funnel).
 */
export function plantedOnlyPoleSummary(input: {
  pole_number: string;
  zone_no: number | null;
  pon_no: number | null;
  field_status: string | null;
}): PoleSummary {
  const emptySlots = (d: Discipline): SlotState[] =>
    SLOT_META.filter(s => s.discipline === d).map(() => 'empty' as SlotState);

  return {
    // Synthetic id (no pole_qa_photos row) — prefixed so the table can tell it
    // apart from a real uuid and skip navigation/approve/verify.
    id: `planted:${input.pole_number}`,
    pole_label: input.pole_number,
    zone_no: input.zone_no,
    pon_no: input.pon_no,
    civil_filled: 0,
    dome_filled: 0,
    joint_filled: 0,
    tray_count: 0,
    vlm_failures: 0,
    civil_slots: emptySlots('civil'),
    dome_slots: emptySlots('dome'),
    joint_slots: emptySlots('main_joint'),
    total_photos: 0,
    unassigned_count: 0,
    status: 'planted',
    approved_at: null,
    outstanding_snag_count: 0,
    has_open_verification_snag: false,
    has_verified_planted: false,
    has_photos: false,
    field_status: input.field_status,
  };
}

// Mirrors the previous SQL CASE, with a new 'snagged' tier (outstanding works_qa
// snags) ranked above ready/in_progress but below a completed approval.
function deriveStatus(
  row: PoleOverviewRow,
  present: Set<string>,
  vlmFailures: number,
): PoleSummary['status'] {
  if (row.approved_at) return 'approved';
  if (row.outstanding_snag_count > 0) return 'snagged';

  const allSlotsFilled = SLOT_META.every(s => present.has(s.key));
  if (allSlotsFilled && row.tray_count >= 1 && vlmFailures === 0) return 'ready';

  const anyContent = present.size > 0 || row.tray_count >= 1;
  return anyContent ? 'in_progress' : 'empty';
}
