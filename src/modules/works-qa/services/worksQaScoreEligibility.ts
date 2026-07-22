import { SLOT_META, type Discipline } from '../utils/slot-keys';
import type { VlmSlotResult, SlotApproval } from '../types/works-qa.types';

/** The pole_qa_photos columns the scorer needs to decide what to score. */
export interface ScorableRow {
  id: string;
  civil_step_01_key: string | null; civil_step_02_key: string | null;
  civil_step_03_key: string | null; civil_step_04_key: string | null;
  civil_step_05_key: string | null; civil_step_06_key: string | null;
  civil_step_07_key: string | null; civil_step_08_key: string | null;
  optical_dome_01_key: string | null; optical_dome_02_key: string | null;
  optical_dome_03_key: string | null; optical_dome_04_key: string | null;
  optical_dome_05_key: string | null; optical_dome_06_key: string | null;
  optical_dome_07_key: string | null; optical_dome_08_key: string | null;
  main_joint_11_key: string | null; main_joint_12_key: string | null;
  main_joint_13_key: string | null; main_joint_14_key: string | null;
  main_joint_15_key: string | null; main_joint_16_key: string | null;
  vlm_results: Record<string, VlmSlotResult> | null;
  slot_approvals: Record<string, SlotApproval> | null;
  civil_approved: boolean;
  dome_approved: boolean;
  joint_approved: boolean;
}

function disciplineApproved(row: ScorableRow, d: Discipline): boolean {
  if (d === 'civil') return row.civil_approved;
  if (d === 'dome') return row.dome_approved;
  return row.joint_approved; // main_joint
}

/**
 * Slots that should be VLM-scored on this row: has a photo, not already scored
 * (no boolean `valid` in its vlm_results entry), and not humanly decided (no
 * per-slot approval/snag, and the slot's discipline is not human-approved).
 */
export function eligibleSlotsForRow(row: ScorableRow): Array<{ slotKey: string; photoKey: string }> {
  const vlm = row.vlm_results ?? {};
  const approvals = row.slot_approvals ?? {};
  const out: Array<{ slotKey: string; photoKey: string }> = [];

  for (const meta of SLOT_META) {
    const photoKey = row[meta.dbColumn as keyof ScorableRow] as string | null;
    if (!photoKey) continue;                                   // no photo
    if (typeof vlm[meta.key]?.valid === 'boolean') continue;   // already scored
    if (approvals[meta.key]) continue;                         // per-slot human decision
    if (disciplineApproved(row, meta.discipline)) continue;    // discipline approved
    out.push({ slotKey: meta.key, photoKey });
  }
  return out;
}
