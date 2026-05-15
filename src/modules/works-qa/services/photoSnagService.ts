// Per-photo snag service for works-qa. Internal helpers + types live in
// photoSnagHelpers.ts / photoSnagTypes.ts. See migration 247 for schema.

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { createTicket, updateTicket } from '@/modules/noc/services/ticketService';
import { TicketSource, TicketCategory, TicketStatus, type CreateTicketPayload } from '@/modules/noc/types/ticket';
import { SLOT_META } from '../utils/slot-keys';
import {
  SEVERITY_TO_PRIORITY, DISCIPLINE_TO_TICKET_TYPE,
  assertSlot, loadPoleAndPhoto, findOpenSnagForSlot,
  findOrCreateWorksQaReport, nextSnagNumber,
  buildTicketTitle, buildTicketDescription,
} from './photoSnagHelpers';
import type {
  PhotoSnagRow, PhotoSnagListItem, SlotApproval, SlotApprovals,
  CreatePhotoSnagInput, CreatePhotoSnagResult, ResolvePhotoSnagInput, PoleSnagReport,
} from './photoSnagTypes';

export type {
  SnagSeverity, SlotApproval, SlotApprovals,
  PhotoSnagRow, PhotoSnagListItem,
  CreatePhotoSnagInput, CreatePhotoSnagResult, ResolvePhotoSnagInput, PoleSnagReport,
} from './photoSnagTypes';
export { buildTicketTitle, buildTicketDescription } from './photoSnagHelpers';

/**
 * Create a per-photo snag. Idempotent on (pole_qa_photo_id, slot_key) — if an
 * open snag already exists, returns status='duplicate' plus the existing snag
 * so the caller can prompt the user to amend it (Hein's UX rule).
 */
export async function createPhotoSnag(input: CreatePhotoSnagInput): Promise<CreatePhotoSnagResult> {
  const severity = input.severity ?? 'major';
  // Normalise to null so we never pass empty/whitespace strings through to
  // a ::uuid context (Postgres would throw `invalid input syntax for type uuid`).
  const trimmed = input.assignedToUserId?.trim();
  const assigneeId = trimmed && trimmed.length > 0 ? trimmed : null;

  const existing = await findOpenSnagForSlot(input.poleQaPhotoId, input.slotKey);
  if (existing) {
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
  const reportId = await findOrCreateWorksQaReport(pole.project_id, pole.id, pole.pole_label, input.createdBy);
  const snagNumber = await nextSnagNumber(reportId);

  // Insert snag row. assigned_to is left NULL when assigneeId is null;
  // PR2's API route resolves and re-assigns where appropriate.
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
        $10, $11::uuid, CASE WHEN $11::uuid IS NOT NULL THEN NOW() ELSE NULL END
     )
     RETURNING id, pole_qa_photo_id, slot_key, slot_photo_key, discipline,
               description, severity, status, noc_ticket_id, assigned_to, created_at`,
    [
      reportId, pole.project_id, snagNumber,
      pole.id, input.slotKey, slotPhotoKey, slotMeta.discipline,
      severity, input.comment,
      assigneeId ? 'assigned' : 'open', assigneeId,
    ]
  );
  const snag = snagRows[0]!;

  if (slotPhotoKey) {
    await pool.query(
      `INSERT INTO snag_photos (snag_id, phase, photo_url) VALUES ($1, 'before', $2)`,
      [snag.id, slotPhotoKey]
    );
  }

  // Build linked NOC ticket. external_id matches the existing TQR snag
  // convention (`{ snag_id, tags }`) so any downstream consumer that grouped
  // on tags keeps working; we add the works-qa-specific fields alongside.
  const ticketPayload: CreateTicketPayload = {
    source: TicketSource.SNAGS,
    source_type: 'snag',
    title: buildTicketTitle(pole.pole_label, slotMeta.label),
    description: buildTicketDescription({
      comment: input.comment,
      poleLabel: pole.pole_label,
      slotLabel: slotMeta.label,
      discipline: slotMeta.discipline,
      severity,
      zoneNo: pole.zone_no,
      ponNo: pole.pon_no,
    }),
    ticket_type: DISCIPLINE_TO_TICKET_TYPE[slotMeta.discipline],
    ticket_category: TicketCategory.SNAG,
    priority: SEVERITY_TO_PRIORITY[severity],
    project_id: pole.project_id,
    pon_number: pole.pon_no != null ? String(pole.pon_no) : undefined,
    zone_id: pole.zone_no != null ? String(pole.zone_no) : undefined,
    uid_prefix: 'WQA',
    created_by: input.createdBy,
    external_id: JSON.stringify({
      snag_id: snag.id,
      slot_key: input.slotKey,
      pole_label: pole.pole_label,
      tags: ['snag', 'works_qa', slotMeta.discipline],
    }),
    ...(assigneeId && { assigned_to: assigneeId, status: TicketStatus.ASSIGNED }),
  };
  const ticket = await createTicket(ticketPayload);

  await pool.query(`UPDATE snags SET noc_ticket_id = $1 WHERE id = $2`, [ticket.id, snag.id]);
  snag.noc_ticket_id = ticket.id;

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

  return { status: 'created', snag, ticket, slotApprovals: approvalRows[0]?.slot_approvals ?? {} };
}

/**
 * Resolve (verify) a per-photo snag. Flips slot_approvals back to 'approved'.
 * If closeTicket=true and the snag has a linked NOC ticket, auto-transitions
 * the ticket to 'resolved' (NOC team still formally closes).
 */
export async function resolvePhotoSnag(input: ResolvePhotoSnagInput): Promise<{ snag: PhotoSnagRow; ticketResolved: boolean }> {
  const { rows: snagRows } = await pool.query<PhotoSnagRow>(
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
    // Use updateTicket() rather than a direct SQL UPDATE so the ticket
    // service's normal lifecycle runs: previous_status capture, activity-log
    // entry, downstream notifications. updateTicket() does NOT auto-stamp
    // resolved_at on status transitions, so we pass it explicitly here —
    // /api/snags/closeout-report and other dashboards filter on resolved_at.
    await updateTicket(snag.noc_ticket_id, {
      status: TicketStatus.RESOLVED,
      resolved_at: new Date(),
    });
    ticketResolved = true;
  }

  log.info('works-qa.photoSnag.resolved', { snag_id: snag.id, ticket_resolved: ticketResolved });
  return { snag, ticketResolved };
}

/** Approve a single slot. No NOC ticket; just updates slot_approvals JSONB. */
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

/**
 * List snags for one pole. Joins maintenance_tickets for the ticket UID and
 * users for the assignee's display name.
 *
 * NOTE: snags.assigned_to references users(id). We join users directly and use
 * first_name/last_name (the `users` table has no single `name` column). The
 * staff↔user bridge (staff.user_id → users.id) is handled at write-time by the
 * /api/works-qa/photo-snag and /assignable-users routes — by the time a row
 * is in `snags.assigned_to`, it is already a users.id.
 */
export async function listPhotoSnags(poleQaPhotoId: string): Promise<PhotoSnagListItem[]> {
  const { rows } = await pool.query<PhotoSnagListItem>(
    `SELECT s.id, s.pole_qa_photo_id, s.slot_key, s.slot_photo_key, s.discipline,
            s.description, s.severity, s.status, s.noc_ticket_id, s.assigned_to, s.created_at,
            t.ticket_uid AS ticket_uid,
            NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), '') AS assignee_name,
            pq.pole_label
       FROM snags s
       JOIN pole_qa_photos pq ON pq.id = s.pole_qa_photo_id
       LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
       LEFT JOIN users u ON u.id = s.assigned_to
      WHERE s.source = 'works_qa' AND s.pole_qa_photo_id = $1
      ORDER BY s.created_at DESC`,
    [poleQaPhotoId]
  );
  return rows;
}

/** Aggregate snag report for a pole. Lazily materialises the snag_reports row. */
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

  const reportId = await findOrCreateWorksQaReport(pole.project_id, pole.id, pole.pole_label, generatedBy);
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
