// Per-photo snag service for works-qa.
//
// Pure functions — no HTTP. Used by API routes (PR2) and tested in isolation.
// All snags here use source='works_qa'; pole_qa_photo_id + slot_key linkage to
// the existing snags table (Option A — see migration 247).

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketCategory,
  TicketStatus,
  TicketPriority,
  TicketType,
  type Ticket,
  type CreateTicketPayload,
} from '@/modules/noc/types/ticket';
import { SLOT_META, getSlotMeta, type SlotMeta } from '../utils/slot-keys';

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

export interface CreatePhotoSnagInput {
  poleQaPhotoId: string;
  slotKey: string;
  comment: string;
  severity?: SnagSeverity;
  assignedToUserId?: string;
  createdBy: string;
}

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
  closeTicket: boolean;        // true → auto-transition NOC ticket to 'resolved'
}

const SEVERITY_TO_PRIORITY: Record<SnagSeverity, TicketPriority> = {
  minor: TicketPriority.LOW,
  major: TicketPriority.NORMAL,
  critical: TicketPriority.HIGH,
};

const DISCIPLINE_TO_TICKET_TYPE: Record<'civil' | 'dome' | 'main_joint', TicketType> = {
  civil: TicketType.CIVILS,
  dome: TicketType.OPTICAL,
  main_joint: TicketType.OPTICAL,
};

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function assertSlot(slotKey: string): SlotMeta {
  const meta = getSlotMeta(slotKey);
  if (!meta) throw new Error(`Unknown slot key: ${slotKey}`);
  return meta;
}

async function loadPoleAndPhoto(poleQaPhotoId: string, slotKey: string): Promise<{
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
}> {
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

async function findOpenSnagForSlot(poleQaPhotoId: string, slotKey: string): Promise<PhotoSnagRow | null> {
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

async function findOrCreateWorksQaReport(
  projectId: string,
  poleQaPhotoId: string,
  poleLabel: string,
  createdBy: string
): Promise<string> {
  // One auto-generated works-qa report per pole. Unique partial index in
  // migration 247 guards against duplicates if two callers race.
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
     ON CONFLICT (pole_qa_photo_id) WHERE source = 'works_qa'
       DO UPDATE SET report_number = EXCLUDED.report_number
     RETURNING id`,
    [projectId, reportNumber, poleQaPhotoId, createdBy]
  );
  return inserted.rows[0]!.id;
}

async function nextSnagNumber(reportId: string): Promise<number> {
  const { rows } = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(snag_number), 0) + 1 AS next
       FROM snags
      WHERE report_id = $1`,
    [reportId]
  );
  return rows[0]?.next ?? 1;
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Create a per-photo snag. Idempotent on (pole_qa_photo_id, slot_key) — if an
 * open snag already exists, returns `status: 'duplicate'` plus the existing
 * snag so the caller can prompt the user to amend it instead of creating a
 * second one (Hein's UX rule: block duplicates, offer amend).
 */
export async function createPhotoSnag(input: CreatePhotoSnagInput): Promise<CreatePhotoSnagResult> {
  const severity = input.severity ?? 'major';
  const existing = await findOpenSnagForSlot(input.poleQaPhotoId, input.slotKey);
  if (existing) {
    // Return the existing slot_approvals snapshot so the UI stays consistent.
    const { rows } = await pool.query<{ slot_approvals: SlotApprovals | null }>(
      `SELECT slot_approvals FROM pole_qa_photos WHERE id = $1 LIMIT 1`,
      [input.poleQaPhotoId]
    );
    return {
      status: 'duplicate',
      snag: existing,
      slotApprovals: rows[0]?.slot_approvals ?? {},
    };
  }

  const { pole, slotPhotoKey, slotMeta } = await loadPoleAndPhoto(input.poleQaPhotoId, input.slotKey);

  // Auto-assign to project site manager when no explicit assignee.
  let assigneeId = input.assignedToUserId;
  if (!assigneeId) {
    const { rows: managerRows } = await pool.query<{ person_id: string }>(
      `SELECT person_id FROM v_project_team
        WHERE project_id = $1
          AND person_type = 'staff'
          AND is_active = true
          AND LOWER(role) = 'site manager'
        LIMIT 1`,
      [pole.project_id]
    );
    assigneeId = managerRows[0]?.person_id;
  }

  const reportId = await findOrCreateWorksQaReport(
    pole.project_id,
    pole.id,
    pole.pole_label,
    input.createdBy
  );
  const snagNumber = await nextSnagNumber(reportId);

  // Insert snag row.
  const { rows: snagRows } = await pool.query<PhotoSnagRow>(
    `INSERT INTO snags (
        report_id, project_id, snag_number,
        source, pole_qa_photo_id, slot_key, slot_photo_key, discipline,
        category, severity, description,
        status, assigned_to, assigned_at
     )
     VALUES (
        $1, $2, $3,
        'works_qa', $4, $5, $6, $7,
        'Workmanship', $8, $9,
        $10, $11, CASE WHEN $11::uuid IS NOT NULL THEN NOW() ELSE NULL END
     )
     RETURNING id, pole_qa_photo_id, slot_key, slot_photo_key, discipline,
               description, severity, status, noc_ticket_id, assigned_to, created_at`,
    [
      reportId,
      pole.project_id,
      snagNumber,
      pole.id,
      input.slotKey,
      slotPhotoKey,
      slotMeta.discipline,
      severity,
      input.comment,
      assigneeId ? 'assigned' : 'open',
      assigneeId ?? null,
    ]
  );
  const snag = snagRows[0]!;

  // Attach before-photo (if the slot has one) for the snag-photos timeline.
  if (slotPhotoKey) {
    await pool.query(
      `INSERT INTO snag_photos (snag_id, phase, photo_url)
       VALUES ($1, 'before', $2)`,
      [snag.id, slotPhotoKey]
    );
  }

  // Create the linked NOC ticket.
  const title = buildTicketTitle(pole.pole_label, slotMeta.label);
  const description = buildTicketDescription({
    comment: input.comment,
    poleLabel: pole.pole_label,
    slotLabel: slotMeta.label,
    discipline: slotMeta.discipline,
    severity,
    zoneNo: pole.zone_no,
    ponNo: pole.pon_no,
  });
  const ticketPayload: CreateTicketPayload = {
    source: TicketSource.SNAGS,
    source_type: 'snag',
    title,
    description,
    ticket_type: DISCIPLINE_TO_TICKET_TYPE[slotMeta.discipline],
    ticket_category: TicketCategory.SNAG,
    priority: SEVERITY_TO_PRIORITY[severity],
    project_id: pole.project_id,
    pon_number: pole.pon_no != null ? String(pole.pon_no) : undefined,
    zone_id: pole.zone_no != null ? String(pole.zone_no) : undefined,
    uid_prefix: 'WQA',
    created_by: input.createdBy,
    external_id: JSON.stringify({ snag_id: snag.id, slot_key: input.slotKey, pole_label: pole.pole_label }),
    ...(assigneeId && { assigned_to: assigneeId, status: TicketStatus.ASSIGNED }),
  };
  const ticket = await createTicket(ticketPayload);

  // Bidirectional link.
  await pool.query(`UPDATE snags SET noc_ticket_id = $1 WHERE id = $2`, [ticket.id, snag.id]);
  snag.noc_ticket_id = ticket.id;

  // Update pole_qa_photos.slot_approvals JSONB to mark this slot snagged.
  const newApproval: SlotApproval = {
    decision: 'snagged',
    by: input.createdBy,
    at: new Date().toISOString(),
    snag_id: snag.id,
  };
  const { rows: approvalRows } = await pool.query<{ slot_approvals: SlotApprovals }>(
    `UPDATE pole_qa_photos
        SET slot_approvals = slot_approvals || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1
      RETURNING slot_approvals`,
    [pole.id, input.slotKey, JSON.stringify(newApproval)]
  );

  log.info('works-qa.photoSnag.created', {
    snag_id: snag.id,
    ticket_id: ticket.id,
    pole_label: pole.pole_label,
    slot_key: input.slotKey,
  });

  return {
    status: 'created',
    snag,
    ticket,
    slotApprovals: approvalRows[0]?.slot_approvals ?? {},
  };
}

/**
 * Resolve (verify) a per-photo snag. If closeTicket is true and the snag has
 * a linked NOC ticket, the ticket is auto-transitioned to 'resolved' (NOC team
 * still has to formally close it).
 */
export async function resolvePhotoSnag(input: ResolvePhotoSnagInput): Promise<{ snag: PhotoSnagRow; ticketResolved: boolean }> {
  const { rows: snagRows } = await pool.query<PhotoSnagRow & { pole_qa_photo_id: string }>(
    `UPDATE snags
        SET status = 'verified',
            verified_by = $2,
            verified_at = NOW(),
            verification_notes = $3
      WHERE id = $1 AND source = 'works_qa'
      RETURNING id, pole_qa_photo_id, slot_key, slot_photo_key, discipline,
                description, severity, status, noc_ticket_id, assigned_to, created_at`,
    [input.snagId, input.resolvedBy, input.resolutionNote ?? null]
  );
  const snag = snagRows[0];
  if (!snag) throw new Error(`works-qa snag not found: ${input.snagId}`);

  // Slot transitions from 'snagged' back to 'approved' on resolve.
  const updatedApproval: SlotApproval = {
    decision: 'approved',
    by: input.resolvedBy,
    at: new Date().toISOString(),
  };
  await pool.query(
    `UPDATE pole_qa_photos
        SET slot_approvals = slot_approvals || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1`,
    [snag.pole_qa_photo_id, snag.slot_key, JSON.stringify(updatedApproval)]
  );

  let ticketResolved = false;
  if (input.closeTicket && snag.noc_ticket_id) {
    await pool.query(
      `UPDATE maintenance_tickets
          SET status = 'resolved', updated_at = NOW(), resolved_at = NOW()
        WHERE id = $1`,
      [snag.noc_ticket_id]
    );
    ticketResolved = true;
  }

  log.info('works-qa.photoSnag.resolved', {
    snag_id: snag.id,
    ticket_resolved: ticketResolved,
  });

  return { snag, ticketResolved };
}

export interface PhotoSnagListItem extends PhotoSnagRow {
  ticket_uid: string | null;
  assignee_name: string | null;
  pole_label: string;
}

export async function listPhotoSnags(poleQaPhotoId: string): Promise<PhotoSnagListItem[]> {
  const { rows } = await pool.query<PhotoSnagListItem>(
    `SELECT s.id, s.pole_qa_photo_id, s.slot_key, s.slot_photo_key, s.discipline,
            s.description, s.severity, s.status, s.noc_ticket_id, s.assigned_to, s.created_at,
            t.uid AS ticket_uid,
            COALESCE(staff.name, u.name) AS assignee_name,
            pq.pole_label
       FROM snags s
       JOIN pole_qa_photos pq ON pq.id = s.pole_qa_photo_id
       LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
       LEFT JOIN users u ON u.id = s.assigned_to
       LEFT JOIN staff ON staff.user_id = s.assigned_to
      WHERE s.source = 'works_qa' AND s.pole_qa_photo_id = $1
      ORDER BY s.created_at DESC`,
    [poleQaPhotoId]
  );
  return rows;
}

export interface PoleSnagReport {
  pole: { id: string; pole_label: string; zone_no: number | null; pon_no: number | null; project_id: string };
  totals: { total: number; approved: number; snagged: number; pending: number };
  snags: PhotoSnagListItem[];
  report_id: string;     // snag_reports row (auto-created on first snag for the pole)
  generated_at: string;
}

/**
 * Aggregate snag report for a pole. Always returns; does NOT require the user
 * to have created a snag yet — empty pole returns an empty report and the
 * snag_reports row is materialised lazily.
 */
export async function getPoleSnagReport(poleQaPhotoId: string, generatedBy: string): Promise<PoleSnagReport> {
  const { rows: poleRows } = await pool.query<{
    id: string;
    pole_label: string;
    zone_no: number | null;
    pon_no: number | null;
    project_id: string;
    slot_approvals: SlotApprovals | null;
  }>(
    `SELECT id, pole_label, zone_no, pon_no, project_id, slot_approvals
       FROM pole_qa_photos WHERE id = $1 LIMIT 1`,
    [poleQaPhotoId]
  );
  const pole = poleRows[0];
  if (!pole) throw new Error(`pole_qa_photos row not found: ${poleQaPhotoId}`);

  const approvals = pole.slot_approvals ?? {};
  const total = SLOT_META.length;
  let approved = 0;
  let snagged = 0;
  for (const slot of SLOT_META) {
    const decision = approvals[slot.key]?.decision;
    if (decision === 'approved') approved++;
    else if (decision === 'snagged') snagged++;
  }
  const pending = total - approved - snagged;

  // Materialise snag_reports row so the report shows up in /field-ops/snags.
  const reportId = await findOrCreateWorksQaReport(
    pole.project_id,
    pole.id,
    pole.pole_label,
    generatedBy
  );

  const snags = await listPhotoSnags(poleQaPhotoId);

  return {
    pole: {
      id: pole.id,
      pole_label: pole.pole_label,
      zone_no: pole.zone_no,
      pon_no: pole.pon_no,
      project_id: pole.project_id,
    },
    totals: { total, approved, snagged, pending },
    snags,
    report_id: reportId,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Approve a single slot. No NOC ticket; just updates slot_approvals JSONB.
 */
export async function approvePhoto(input: { poleQaPhotoId: string; slotKey: string; approvedBy: string }): Promise<SlotApprovals> {
  assertSlot(input.slotKey);
  const approval: SlotApproval = {
    decision: 'approved',
    by: input.approvedBy,
    at: new Date().toISOString(),
  };
  const { rows } = await pool.query<{ slot_approvals: SlotApprovals }>(
    `UPDATE pole_qa_photos
        SET slot_approvals = slot_approvals || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1
      RETURNING slot_approvals`,
    [input.poleQaPhotoId, input.slotKey, JSON.stringify(approval)]
  );
  if (!rows[0]) throw new Error(`pole_qa_photos row not found: ${input.poleQaPhotoId}`);
  return rows[0].slot_approvals;
}

// --------------------------------------------------------------------------
// Title / description builders (exported so PR2 API route can reuse if needed)
// --------------------------------------------------------------------------

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
