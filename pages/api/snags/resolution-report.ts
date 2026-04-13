/**
 * Snag Resolution Report API
 *
 * GET /api/snags/resolution-report
 *
 * Returns snags resolved/fixed within a date range, with full context
 * including photos (before/after) and NOC ticket notes.
 *
 * Query params:
 *   date_from    — ISO date string (required) — filters by audit_date >= date_from
 *   date_to      — ISO date string (required) — filters by audit_date <= date_to
 *   project_id   — UUID (optional)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export interface ResolutionPhoto {
  id: string;
  phase: string;            // 'before' | 'after' | 'during'
  photo_url: string;
  thumbnail_url: string | null;
}

export interface ResolutionNote {
  content: string;
  note_type: string;
  created_by_name: string | null;
  created_at: string;
}

export interface ResolutionReportRow {
  id: string;
  project_id: string;
  project_name: string;
  report_number: string;
  audit_date: string;
  description: string;
  pole_reference: string | null;
  zone_no: number | null;
  pon_no: number | null;
  category: string;
  severity: string;
  status: string;
  snag_number: number;
  opened_date: string;           // audit_date from report
  resolved_date: string | null;  // fixed_at or updated_at
  assigned_to_name: string | null;
  noc_ticket_uid: string | null;
  noc_ticket_id: string | null;
  verification_notes: string | null;
  photos: ResolutionPhoto[];
  notes: ResolutionNote[];
}

const SNAG_QUERY_FIELDS = `
  s.id,
  s.project_id,
  s.noc_ticket_id,
  s.verification_notes,
  p.project_name,
  sr.report_number,
  sr.audit_date,
  s.description,
  s.pole_references[1]                                   AS pole_reference,
  COALESCE(pole.zone_no, dr.zone_no, zb.zone_no)         AS zone_no,
  COALESCE(pole.pon_no,  dr.pon_no,  pb.pon_no)          AS pon_no,
  s.category,
  s.severity,
  s.status,
  s.snag_number,
  sr.audit_date                                          AS opened_date,
  COALESCE(s.fixed_at, s.updated_at)                     AS resolved_date,
  (u.first_name || ' ' || u.last_name)                   AS assigned_to_name,
  mt.ticket_uid                                          AS noc_ticket_uid
`;

const SNAG_JOINS = `
  LEFT JOIN projects p          ON p.id = s.project_id
  LEFT JOIN snag_reports sr     ON sr.id = s.report_id
  LEFT JOIN users u             ON u.id = s.assigned_to
  LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
  LEFT JOIN poles pole          ON pole.id = s.pole_ids[1]
  LEFT JOIN drops dr            ON dr.id = s.drop_id
  LEFT JOIN zone_boundaries zb  ON zb.id = s.zone_id
  LEFT JOIN pon_boundaries pb   ON pb.id = s.pon_id
`;

type RawSnagRow = Record<string, unknown>;

async function attachPhotosAndNotes(snagRows: RawSnagRow[]): Promise<ResolutionReportRow[]> {
  if (snagRows.length === 0) return [];

  const snagIds = snagRows.map((s) => s.id as string);
  const ticketIds = snagRows
    .map((s) => s.noc_ticket_id as string | null)
    .filter((id): id is string => !!id);

  // Batch-fetch photos and notes in parallel
  const [photoRows, noteRows] = await Promise.all([
    sql`
      SELECT id, snag_id, phase, photo_url, thumbnail_url
      FROM snag_photos
      WHERE snag_id = ANY(${snagIds})
        AND phase IN ('before', 'after')
      ORDER BY phase ASC, created_at ASC
    ` as Array<{ id: string; snag_id: string; phase: string; photo_url: string; thumbnail_url: string | null }>,
    ticketIds.length > 0
      ? sql`
          SELECT mn.ticket_id, mn.content, mn.note_type, mn.created_at,
                 (u.first_name || ' ' || u.last_name) AS created_by_name
          FROM maintenance_notes mn
          LEFT JOIN users u ON u.id = mn.created_by
          WHERE mn.ticket_id = ANY(${ticketIds})
            AND mn.note_type IN ('internal', 'external')
          ORDER BY mn.created_at ASC
        ` as Array<{ ticket_id: string; content: string; note_type: string; created_at: string; created_by_name: string | null }>
      : Promise.resolve([]),
  ]);

  // Group by snag / ticket
  const photosBySnag = new Map<string, ResolutionPhoto[]>();
  for (const p of photoRows) {
    if (!photosBySnag.has(p.snag_id)) photosBySnag.set(p.snag_id, []);
    photosBySnag.get(p.snag_id)!.push({
      id: p.id,
      phase: p.phase,
      photo_url: p.photo_url,
      thumbnail_url: p.thumbnail_url,
    });
  }

  const notesByTicket = new Map<string, ResolutionNote[]>();
  for (const n of noteRows) {
    if (!notesByTicket.has(n.ticket_id)) notesByTicket.set(n.ticket_id, []);
    notesByTicket.get(n.ticket_id)!.push({
      content: n.content,
      note_type: n.note_type,
      created_by_name: n.created_by_name,
      created_at: n.created_at,
    });
  }

  return snagRows.map((s) => ({
    id: s.id as string,
    project_id: s.project_id as string,
    project_name: s.project_name as string,
    report_number: s.report_number as string,
    audit_date: s.audit_date as string,
    description: s.description as string,
    pole_reference: s.pole_reference as string | null,
    zone_no: s.zone_no as number | null,
    pon_no: s.pon_no as number | null,
    category: s.category as string,
    severity: s.severity as string,
    status: s.status as string,
    snag_number: s.snag_number as number,
    opened_date: s.opened_date as string,
    resolved_date: s.resolved_date as string | null,
    assigned_to_name: s.assigned_to_name as string | null,
    noc_ticket_uid: s.noc_ticket_uid as string | null,
    noc_ticket_id: s.noc_ticket_id as string | null,
    verification_notes: s.verification_notes as string | null,
    photos: photosBySnag.get(s.id as string) ?? [],
    notes: notesByTicket.get(s.noc_ticket_id as string) ?? [],
  }));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { date_from, date_to, project_id } = req.query;

  if (!date_from || typeof date_from !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'date_from is required');
  }
  if (!date_to || typeof date_to !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'date_to is required');
  }

  const dateFrom = new Date(date_from);
  const dateTo = new Date(date_to);
  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid date format');
  }

  const fromStr = dateFrom.toISOString().slice(0, 10);
  const toStr   = dateTo.toISOString().slice(0, 10);

  try {
    log.info('ResolutionReport: querying', { date_from, date_to, project_id });

    let snagRows: RawSnagRow[];

    if (project_id && typeof project_id === 'string') {
      snagRows = await sql`
        SELECT ${sql.unsafe(SNAG_QUERY_FIELDS)}
        FROM snags s
        ${sql.unsafe(SNAG_JOINS)}
        WHERE s.project_id = ${project_id}
          AND s.status IN ('pending_qa', 'resolved', 'verified', 'closed')
          AND sr.audit_date >= ${fromStr}
          AND sr.audit_date <= ${toStr}
        ORDER BY sr.audit_date ASC, s.snag_number ASC
      ` as RawSnagRow[];
    } else {
      snagRows = await sql`
        SELECT ${sql.unsafe(SNAG_QUERY_FIELDS)}
        FROM snags s
        ${sql.unsafe(SNAG_JOINS)}
        WHERE s.status IN ('pending_qa', 'resolved', 'verified', 'closed')
          AND sr.audit_date >= ${fromStr}
          AND sr.audit_date <= ${toStr}
        ORDER BY p.project_name ASC, sr.audit_date ASC, s.snag_number ASC
      ` as RawSnagRow[];
    }

    const rows = await attachPhotosAndNotes(snagRows);

    log.info('ResolutionReport: done', { count: rows.length });
    return apiResponse.success(res, { rows, date_from, date_to });

  } catch (error) {
    log.error('ResolutionReport: failed', { error });
    return apiResponse.internalError(res, error, 'Resolution report failed');
  }
}

export default withAuth(handler);
