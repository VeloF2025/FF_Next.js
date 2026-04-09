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
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { projectId, status, zone_no, pon_no } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.error(res, 400 as never, 'projectId is required');
  }

  try {
    // 1. Project info
    const projectRows = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    ` as Array<{ id: string; project_name: string }>;

    if (projectRows.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const statusFilter = typeof status === 'string' && status ? status : null;
    const zoneFilter = typeof zone_no === 'string' && zone_no ? parseInt(zone_no, 10) : null;
    const ponFilter = typeof pon_no === 'string' && pon_no ? parseInt(pon_no, 10) : null;

    // 2. Snags with joins
    const snagRows = await sql`
      SELECT
        s.id, s.snag_number, s.description, s.category, s.severity, s.status,
        s.pole_references, s.verification_notes, s.created_at,
        s.assigned_at, s.fixed_at, s.verified_at, s.closed_at,
        s.noc_ticket_id,
        (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        sr.report_number, sr.audit_date,
        mt.ticket_uid AS noc_ticket_uid,
        COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
        COALESCE(pole.pon_no, dr.pon_no) AS pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND (${statusFilter}::text IS NULL OR s.status = ${statusFilter})
        AND (${zoneFilter}::int IS NULL OR COALESCE(pole.zone_no, dr.zone_no) = ${zoneFilter})
        AND (${ponFilter}::int IS NULL OR COALESCE(pole.pon_no, dr.pon_no) = ${ponFilter})
      ORDER BY COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST,
               COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST,
               s.snag_number ASC
    ` as Array<Record<string, unknown>>;

    // 3. Batch-fetch photos for all snags
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

    // 4. Batch-fetch NOC ticket notes
    const ticketIds = snagRows
      .map((s) => s.noc_ticket_id as string | null)
      .filter((id): id is string => !!id);
    let noteRows: Array<Record<string, unknown>> = [];
    if (ticketIds.length > 0) {
      noteRows = await sql`
        SELECT
          tn.ticket_id, tn.content, tn.note_type, tn.created_at,
          (u.first_name || ' ' || u.last_name) AS created_by_name
        FROM ticket_notes tn
        LEFT JOIN users u ON u.id = tn.created_by
        WHERE tn.ticket_id = ANY(${ticketIds})
          AND tn.note_type IN ('internal', 'client')
        ORDER BY tn.created_at ASC
      ` as Array<Record<string, unknown>>;
    }

    // 5. Group photos and notes by snag
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

    // 6. Build response
    const snags: CloseoutSnag[] = snagRows.map((s) => ({
      id: s.id as string,
      snag_number: s.snag_number as number,
      description: s.description as string,
      category: s.category as string,
      severity: s.severity as string,
      status: s.status as string,
      pole_references: s.pole_references as string[] | null,
      assigned_to_name: s.assigned_to_name as string | null,
      verification_notes: s.verification_notes as string | null,
      created_at: s.created_at as string,
      assigned_at: s.assigned_at as string | null,
      fixed_at: s.fixed_at as string | null,
      verified_at: s.verified_at as string | null,
      closed_at: s.closed_at as string | null,
      report_number: s.report_number as string | null,
      audit_date: s.audit_date as string | null,
      zone_no: s.zone_no !== null ? Number(s.zone_no) : null,
      pon_no: s.pon_no !== null ? Number(s.pon_no) : null,
      noc_ticket_id: s.noc_ticket_id as string | null,
      noc_ticket_uid: s.noc_ticket_uid as string | null,
      photos: photosBySnag.get(s.id as string) ?? [],
      notes: s.noc_ticket_id ? (notesByTicket.get(s.noc_ticket_id as string) ?? []) : [],
    }));

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

    const data: CloseoutReportData = {
      project_name: projectRows[0]!.project_name,
      project_id: projectId,
      generated_at: new Date().toISOString(),
      filters: {
        status: statusFilter ?? undefined,
        zone_no: zoneFilter ?? undefined,
        pon_no: ponFilter ?? undefined,
      },
      summary,
      snags,
    };

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Closeout report API error', { error, projectId });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
