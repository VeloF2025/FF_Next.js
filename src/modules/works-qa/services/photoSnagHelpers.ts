// Internal helpers for photoSnagService.
//
// Kept here (separate file) so photoSnagService.ts stays under the 300-line
// hard rule from CLAUDE.md. These are not part of the module's public surface;
// only photoSnagService.ts should import from this file.

import pool from '@/lib/db';
import { TicketPriority, TicketType } from '@/modules/noc/types/ticket';
import { getSlotMeta, type SlotMeta } from '../utils/slot-keys';
import type { PhotoSnagRow, SlotApprovals, SnagSeverity } from './photoSnagTypes';

export const SEVERITY_TO_PRIORITY: Record<SnagSeverity, TicketPriority> = {
  minor: TicketPriority.LOW,
  major: TicketPriority.NORMAL,
  critical: TicketPriority.HIGH,
};

export const DISCIPLINE_TO_TICKET_TYPE: Record<'civil' | 'dome' | 'main_joint', TicketType> = {
  civil: TicketType.CIVILS,
  dome: TicketType.OPTICAL,
  main_joint: TicketType.OPTICAL,
};

export function assertSlot(slotKey: string): SlotMeta {
  const meta = getSlotMeta(slotKey);
  if (!meta) throw new Error(`Unknown slot key: ${slotKey}`);
  return meta;
}

export interface LoadedPole {
  pole: {
    id: string;
    project_id: string;
    pole_label: string;
    zone_no: number | null;
    pon_no: number | null;
    slot_approvals: SlotApprovals;
  };
  slotPhotoKey: string | null;
  slotMeta: SlotMeta;
}

export async function loadPoleAndPhoto(poleQaPhotoId: string, slotKey: string): Promise<LoadedPole> {
  const slotMeta = assertSlot(slotKey);
  const { rows } = await pool.query<{
    id: string;
    project_id: string;
    pole_label: string;
    zone_no: number | null;
    pon_no: number | null;
    slot_approvals: SlotApprovals | null;
    slot_photo_key: string | null;
  }>(
    `SELECT id, project_id, pole_label, zone_no, pon_no, slot_approvals,
            ${slotMeta.dbColumn} AS slot_photo_key
       FROM pole_qa_photos
      WHERE id = $1
      LIMIT 1`,
    [poleQaPhotoId]
  );
  const row = rows[0];
  if (!row) throw new Error(`pole_qa_photos row not found: ${poleQaPhotoId}`);
  return {
    pole: {
      id: row.id,
      project_id: row.project_id,
      pole_label: row.pole_label,
      zone_no: row.zone_no,
      pon_no: row.pon_no,
      slot_approvals: row.slot_approvals ?? {},
    },
    slotPhotoKey: row.slot_photo_key,
    slotMeta,
  };
}

export async function findOpenSnagForSlot(poleQaPhotoId: string, slotKey: string): Promise<PhotoSnagRow | null> {
  const { rows } = await pool.query<PhotoSnagRow>(
    `SELECT id, pole_qa_photo_id, slot_key, slot_photo_key, discipline,
            description, severity, status, noc_ticket_id, assigned_to, created_at
       FROM snags
      WHERE source = 'works_qa'
        AND pole_qa_photo_id = $1
        AND slot_key = $2
        AND status NOT IN ('verified','closed')
      ORDER BY created_at DESC
      LIMIT 1`,
    [poleQaPhotoId, slotKey]
  );
  return rows[0] ?? null;
}

// Find-or-create the auto-generated works-qa snag_reports row for a pole.
// Concurrency-safe: relies on the unique partial index from migration 247
// (uq_snag_reports_works_qa_per_pole). On conflict, falls back to SELECT so
// the first writer's report_number is preserved (DO NOTHING + SELECT, not
// DO UPDATE which would clobber the first writer's data).
export async function findOrCreateWorksQaReport(
  projectId: string,
  poleQaPhotoId: string,
  poleLabel: string,
  createdBy: string
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM snag_reports
      WHERE source = 'works_qa' AND pole_qa_photo_id = $1
      LIMIT 1`,
    [poleQaPhotoId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportNumber = `WQA-${poleLabel}-${dateStr}`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO snag_reports (project_id, report_number, source, pole_qa_photo_id, imported_by)
     VALUES ($1, $2, 'works_qa', $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [projectId, reportNumber, poleQaPhotoId, createdBy]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;

  // Lost the race; another writer inserted between our SELECT and our INSERT.
  // Re-read to get their id without clobbering their report_number.
  const reread = await pool.query<{ id: string }>(
    `SELECT id FROM snag_reports
      WHERE source = 'works_qa' AND pole_qa_photo_id = $1
      LIMIT 1`,
    [poleQaPhotoId]
  );
  if (!reread.rows[0]) throw new Error(`Failed to find-or-create snag_reports row for pole ${poleQaPhotoId}`);
  return reread.rows[0].id;
}

export async function nextSnagNumber(reportId: string): Promise<number> {
  const { rows } = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(snag_number), 0) + 1 AS next
       FROM snags
      WHERE report_id = $1`,
    [reportId]
  );
  return rows[0]?.next ?? 1;
}

export function buildTicketTitle(poleLabel: string, slotLabel: string): string {
  const raw = `[SNAG] ${poleLabel} — ${slotLabel}`;
  return raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
}

export function buildTicketDescription(input: {
  comment: string;
  poleLabel: string;
  slotLabel: string;
  discipline: 'civil' | 'dome' | 'main_joint';
  severity: SnagSeverity;
  zoneNo: number | null;
  ponNo: number | null;
}): string {
  return [
    input.comment,
    '',
    `Pole: ${input.poleLabel}`,
    `Slot: ${input.slotLabel} (${input.discipline})`,
    input.zoneNo != null ? `Zone: ${input.zoneNo}` : null,
    input.ponNo != null ? `PON: ${input.ponNo}` : null,
    `Severity: ${input.severity}`,
  ].filter(Boolean).join('\n');
}
