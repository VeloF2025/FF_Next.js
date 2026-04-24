/**
 * Snag Closeout Report API
 * GET /api/snags/closeout-report?projectId=X[&status=closed&zone_no=2&pon_no=28]
 *
 * Returns all snag data needed for the closeout PDF:
 * - Project info
 * - Snags with photos (before/during/after)
 * - NOC ticket notes for each linked ticket
 * - Summary statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

export interface CloseoutSnag {
  id: string;
  snag_number: number;
  description: string;
  category: string;
  severity: string;
  status: string;
  pole_references: string[] | null;
  assigned_to_name: string | null;
  verification_notes: string | null;
  created_at: string;
  assigned_at: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  report_number: string | null;
  audit_date: string | null;
  zone_no: number | null;
  pon_no: number | null;
  noc_ticket_id: string | null;
  noc_ticket_uid: string | null;
  photos: CloseoutPhoto[];
  notes: CloseoutNote[];
}

export interface CloseoutPhoto {
  id: string;
  phase: string;
  photo_url: string;
  thumbnail_url: string | null;
  caption: string | null;
}

export interface CloseoutNote {
  content: string;
  note_type: string;
  created_by_name: string | null;
  created_at: string;
}

export interface CloseoutReportSubmitter {
  name: string;
  title: string | null;
  signature_data_url?: string | null;
}

export interface CloseoutReportData {
  project_name: string;
  project_id: string;
  generated_at: string;
  filters: { status?: string; zone_no?: number; pon_no?: number };
  summary: {
    total: number;
    open: number;
    assigned: number;
    in_progress: number;
    pending_qa: number;
    resolved: number;
    verified: number;
    closed: number;
  };
  snags: CloseoutSnag[];
  submitter: CloseoutReportSubmitter | null;
}

function formatRole(role: string | undefined): string | null {
  if (!role) return null;
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const authUser = (req as AuthenticatedNextApiRequest).user;
  const { projectId, status, zone_no, pon_no } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.error(res, 400 as never, 'projectId is required');
  }

  const parseCsv = (v: unknown): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v.flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
    return String(v).split(',').map((x) => x.trim()).filter(Boolean);
  };
  const parseCsvInt = (v: unknown): number[] =>
    parseCsv(v).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));

  try {
    // 1. Project info
    const projectRows = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    ` as Array<{ id: string; project_name: string }>;

    if (projectRows.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const statusArr = parseCsv(status);
    const zoneArr   = parseCsvInt(zone_no);
    const ponArr    = parseCsvInt(pon_no);
    const statusParam = statusArr.length > 0 ? statusArr : null;
    const zoneParam   = zoneArr.length   > 0 ? zoneArr   : null;
    const ponParam    = ponArr.length    > 0 ? ponArr    : null;

    // 2. Snags with joins.
    // The NOC workflow drives snag resolution, so assigned_at/fixed_at/etc. and
    // the assignee are often only set on the linked maintenance_ticket. We pull
    // the ticket's data alongside the snag and resolve fallbacks below.
    const snagRows = await sql`
      SELECT
        s.id, s.snag_number, s.description, s.category, s.severity, s.status,
        s.pole_references, s.verification_notes, s.created_at,
        s.assigned_at, s.fixed_at, s.verified_at, s.closed_at,
        s.noc_ticket_id,
        (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date,
        mt.ticket_uid AS noc_ticket_uid,
        mt.created_at AS ticket_created_at,
        mt.resolved_at AS ticket_resolved_at,
        mt.closed_at AS ticket_closed_at,
        (COALESCE(tst.first_name, tu.first_name) || ' ' || COALESCE(tst.last_name, tu.last_name)) AS ticket_assignee_name,
        COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
        COALESCE(pole.pon_no, dr.pon_no) AS pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN staff tst ON tst.id = mt.assigned_to
      LEFT JOIN users tu ON tu.id = mt.assigned_to
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND (${statusParam}::text[] IS NULL OR s.status = ANY(${statusParam}::text[]))
        AND (${zoneParam}::int[]    IS NULL OR COALESCE(pole.zone_no, dr.zone_no) = ANY(${zoneParam}::int[]))
        AND (${ponParam}::int[]     IS NULL OR COALESCE(pole.pon_no, dr.pon_no)   = ANY(${ponParam}::int[]))
      ORDER BY COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST,
               COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST,
               s.snag_number ASC
    ` as Array<Record<string, unknown>>;

    // 3. Batch-fetch snag-side photos
    const snagIds = snagRows.map((s) => s.id as string);
    let photoRows: Array<Record<string, unknown>> = [];
    if (snagIds.length > 0) {
      photoRows = await sql`
        SELECT id, snag_id, phase, photo_url, thumbnail_url, caption
        FROM snag_photos
        WHERE snag_id = ANY(${snagIds})
        ORDER BY phase ASC, created_at ASC
      ` as Array<Record<string, unknown>>;
    }

    // 4. Linked NOC ticket IDs — used for notes, evidence photos, status history
    const ticketIds = snagRows
      .map((s) => s.noc_ticket_id as string | null)
      .filter((id): id is string => !!id);

    // 4a. Batch-fetch NOC ticket notes
    let noteRows: Array<Record<string, unknown>> = [];
    if (ticketIds.length > 0) {
      noteRows = await sql`
        SELECT
          mn.ticket_id, mn.content, mn.note_type, mn.created_at,
          (u.first_name || ' ' || u.last_name) AS created_by_name
        FROM maintenance_notes mn
        LEFT JOIN users u ON u.id = mn.created_by
        WHERE mn.ticket_id = ANY(${ticketIds})
          AND mn.note_type IN ('internal', 'external')
        ORDER BY mn.created_at ASC
      ` as Array<Record<string, unknown>>;
    }

    // 4b. Batch-fetch NOC ticket evidence attachments — used as "after" photos
    // when the snag itself has no after photo (NOC flow uploads the fix photo
    // against the ticket, not back on snag_photos).
    let evidenceRows: Array<Record<string, unknown>> = [];
    if (ticketIds.length > 0) {
      evidenceRows = await sql`
        SELECT id, ticket_id, filename, storage_url, file_url, uploaded_at, description
        FROM maintenance_attachments
        WHERE ticket_id = ANY(${ticketIds})
          AND is_evidence = true
          AND (mime_type ILIKE 'image/%' OR file_type ILIKE 'image/%' OR filename ~* '\\.(jpe?g|png|webp|heic|heif)$')
        ORDER BY uploaded_at ASC
      ` as Array<Record<string, unknown>>;
    }

    // 4c. Batch-fetch first timestamp per (ticket, new_status) from history.
    // Used to backfill assigned_at/fixed_at/verified_at when the snag's own
    // columns are blank (most field work stays on the NOC ticket side).
    let historyRows: Array<Record<string, unknown>> = [];
    if (ticketIds.length > 0) {
      historyRows = await sql`
        SELECT ticket_id, new_value, MIN(changed_at) AS at
        FROM maintenance_history
        WHERE ticket_id = ANY(${ticketIds})
          AND field_changed = 'status'
        GROUP BY ticket_id, new_value
      ` as Array<Record<string, unknown>>;
    }

    // 5. Group photos, notes, evidence, and status transitions by id
    const photosBySnag = new Map<string, CloseoutPhoto[]>();
    for (const p of photoRows) {
      const sid = p.snag_id as string;
      if (!photosBySnag.has(sid)) photosBySnag.set(sid, []);
      photosBySnag.get(sid)!.push({
        id: p.id as string,
        phase: p.phase as string,
        photo_url: p.photo_url as string,
        thumbnail_url: p.thumbnail_url as string | null,
        caption: p.caption as string | null,
      });
    }

    const notesByTicket = new Map<string, CloseoutNote[]>();
    for (const n of noteRows) {
      const tid = n.ticket_id as string;
      if (!notesByTicket.has(tid)) notesByTicket.set(tid, []);
      notesByTicket.get(tid)!.push({
        content: n.content as string,
        note_type: n.note_type as string,
        created_by_name: n.created_by_name as string | null,
        created_at: n.created_at as string,
      });
    }

    const evidenceByTicket = new Map<string, Array<{ id: string; url: string; uploaded_at: string; caption: string | null }>>();
    for (const e of evidenceRows) {
      const tid = e.ticket_id as string;
      if (!evidenceByTicket.has(tid)) evidenceByTicket.set(tid, []);
      // Prefer storage_url (relative or absolute); fall back to file_url.
      const url = (e.storage_url as string | null) || (e.file_url as string | null);
      if (!url) continue;
      evidenceByTicket.get(tid)!.push({
        id: e.id as string,
        url,
        uploaded_at: e.uploaded_at as string,
        caption: (e.description as string | null) ?? null,
      });
    }

    // history[ticket_id][new_status] = first_timestamp
    const historyByTicket = new Map<string, Map<string, string>>();
    for (const h of historyRows) {
      const tid = h.ticket_id as string;
      const state = h.new_value as string;
      const at = h.at as string;
      if (!state) continue;
      if (!historyByTicket.has(tid)) historyByTicket.set(tid, new Map());
      historyByTicket.get(tid)!.set(state, at);
    }

    // Pick the earliest timestamp among the supplied status keys for a ticket
    const firstOf = (ticketId: string | null, states: string[]): string | null => {
      if (!ticketId) return null;
      const hist = historyByTicket.get(ticketId);
      if (!hist) return null;
      let earliest: string | null = null;
      for (const state of states) {
        const ts = hist.get(state);
        if (ts && (!earliest || ts < earliest)) earliest = ts;
      }
      return earliest;
    };

    // 6. Build response — backfilling lifecycle data from the NOC ticket
    const snags: CloseoutSnag[] = snagRows.map((s) => {
      const ticketId = (s.noc_ticket_id as string | null) ?? null;

      // Merge snag-side photos with NOC evidence attachments as "after" photos
      const snagPhotos = photosBySnag.get(s.id as string) ?? [];
      const hasAfterOnSnag = snagPhotos.some((p) => p.phase === 'after');
      const ticketEvidence = ticketId ? (evidenceByTicket.get(ticketId) ?? []) : [];
      const mergedPhotos: CloseoutPhoto[] = [...snagPhotos];
      if (!hasAfterOnSnag) {
        for (const ev of ticketEvidence) {
          mergedPhotos.push({
            id: ev.id,
            phase: 'after',
            photo_url: ev.url,
            thumbnail_url: ev.url,
            caption: ev.caption,
          });
        }
      }

      // Fallbacks: snag field first, then NOC ticket/history.
      // - assigned_at → snag.assigned_at | first 'assigned' event | ticket.created_at
      // - fixed_at    → snag.fixed_at    | first 'pending_qa' or 'qa_in_progress' event
      // - verified_at → snag.verified_at | first 'verified' or 'qa_approved' event
      // - closed_at   → snag.closed_at   | ticket.closed_at
      const assignedAt = (s.assigned_at as string | null)
        ?? firstOf(ticketId, ['assigned'])
        ?? (s.ticket_created_at as string | null);
      const fixedAt = (s.fixed_at as string | null)
        ?? firstOf(ticketId, ['pending_qa', 'qa_in_progress'])
        ?? (s.ticket_resolved_at as string | null);
      const verifiedAt = (s.verified_at as string | null)
        ?? firstOf(ticketId, ['verified', 'qa_approved', 'resolved']);
      const closedAt = (s.closed_at as string | null)
        ?? (s.ticket_closed_at as string | null);
      const assignedToName = (s.assigned_to_name as string | null)
        ?? (s.ticket_assignee_name as string | null);

      return {
        id: s.id as string,
        snag_number: s.snag_number as number,
        description: s.description as string,
        category: s.category as string,
        severity: s.severity as string,
        status: s.status as string,
        pole_references: s.pole_references as string[] | null,
        assigned_to_name: assignedToName,
        verification_notes: s.verification_notes as string | null,
        created_at: s.created_at as string,
        assigned_at: assignedAt,
        fixed_at: fixedAt,
        verified_at: verifiedAt,
        closed_at: closedAt,
        report_number: s.report_number as string | null,
        audit_date: s.audit_date as string | null,
        zone_no: s.zone_no !== null ? Number(s.zone_no) : null,
        pon_no: s.pon_no !== null ? Number(s.pon_no) : null,
        noc_ticket_id: ticketId,
        noc_ticket_uid: s.noc_ticket_uid as string | null,
        photos: mergedPhotos,
        notes: ticketId ? (notesByTicket.get(ticketId) ?? []) : [],
      };
    });

    // 7. Summary counts
    const summary = {
      total: snags.length,
      open: snags.filter((s) => ['open', 'reopened'].includes(s.status)).length,
      assigned: snags.filter((s) => s.status === 'assigned').length,
      in_progress: snags.filter((s) => s.status === 'in_progress').length,
      pending_qa: snags.filter((s) => ['pending_qa', 'fixed'].includes(s.status)).length,
      resolved: snags.filter((s) => s.status === 'resolved').length,
      verified: snags.filter((s) => s.status === 'verified').length,
      closed: snags.filter((s) => s.status === 'closed').length,
    };

    const submitter: CloseoutReportSubmitter | null = authUser
      ? {
          name: authUser.name || `${authUser.firstName ?? ''} ${authUser.lastName ?? ''}`.trim() || authUser.email,
          title: formatRole(authUser.role),
        }
      : null;

    const data: CloseoutReportData = {
      project_name: projectRows[0]!.project_name,
      project_id: projectId,
      generated_at: new Date().toISOString(),
      filters: {
        // Preserve a display-friendly summary of the filters used to build the PDF.
        status: statusArr.length > 0 ? statusArr.join(',') : undefined,
        zone_no: zoneArr.length === 1 ? zoneArr[0] : undefined,
        pon_no: ponArr.length === 1 ? ponArr[0]  : undefined,
      },
      summary,
      snags,
      submitter,
    };

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Closeout report API error', { error, projectId });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
