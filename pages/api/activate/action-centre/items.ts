/**
 * GET /api/activate/action-centre/items
 *
 * Flat list of open action items across sources for the Action Centre.
 * Unions ft_billing_deductions + oes_pp_data + olt_mismatch_records + offline_devices
 * into a single shape with a `source` discriminator.
 *
 * Query params:
 *   source    — one of 'deduction' | 'pre_prov' | 'olt_mismatch' | 'offline' | 'all' (default 'all')
 *   note      — filter deductions by note code (note1..note5)
 *   project   — optional project name filter (ILIKE)
 *   search    — DR number ILIKE match (%{search}%)
 *   limit     — default 100, max 500
 *   offset    — default 0
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/action-centre/items');

type Source = 'deduction' | 'pre_prov' | 'olt_mismatch' | 'offline';

interface Item {
  source: Source;
  sourceId: string;
  drNumber: string | null;
  serial: string | null;
  project: string | null;
  team: string | null;
  weekEnding: string | null;
  noteCode: string | null;
  summary: string;
  status: string;
  ticketId: string | null;
  ticketUid: string | null;
  createdAt: string;
}

const VALID_SOURCES: ReadonlyArray<Source> = ['deduction', 'pre_prov', 'olt_mismatch', 'offline'];

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const rawSource = typeof req.query.source === 'string' ? req.query.source : 'all';
  const sources: ReadonlyArray<Source> =
    rawSource === 'all' || !VALID_SOURCES.includes(rawSource as Source)
      ? VALID_SOURCES
      : [rawSource as Source];

  const note = typeof req.query.note === 'string' ? req.query.note.trim() : null;
  const project = typeof req.query.project === 'string' ? req.query.project.trim() : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  try {
    const results = await Promise.all(
      sources.map((s) => fetchBySource(s, { note, project, search, limit, offset }).catch((err) => {
        logger.warn(`items fetch failed for source=${s}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as Item[];
      })),
    );

    const items = results.flat();
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return apiResponse.success(res, {
      count: items.length,
      items: items.slice(0, limit),
      filters: { sources, note, project, search },
    });
  } catch (err) {
    logger.error('items failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

interface ItemFilters {
  note: string | null;
  project: string | null;
  search: string | null;
  limit: number;
  offset: number;
}

async function fetchBySource(source: Source, f: ItemFilters): Promise<Item[]> {
  switch (source) {
    case 'deduction':
      return fetchDeductions(f);
    case 'pre_prov':
      return fetchPreProv(f);
    case 'olt_mismatch':
      return fetchOltMismatch(f);
    case 'offline':
      return fetchOffline(f);
  }
}

async function fetchDeductions(f: ItemFilters): Promise<Item[]> {
  const params: unknown[] = [];
  const clauses: string[] = [`d.resolution_status IN ('open', 'ticketed', 'disputing')`];

  if (f.note) {
    params.push(f.note);
    clauses.push(`d.deduction_note = $${params.length}`);
  }
  if (f.project) {
    params.push(f.project);
    clauses.push(`d.project ILIKE $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    clauses.push(`d.dr_number ILIKE $${params.length}`);
  }

  params.push(f.limit);
  const limitIdx = params.length;
  params.push(f.offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<{
    id: string; dr_number: string; serial_number: string | null; project: string | null;
    team: string | null; week_ending: string; deduction_note: string; resolution_status: string;
    ticket_id: string | null; ticket_uid: string | null; created_at: string;
  }>(
    `SELECT d.id, d.dr_number, d.serial_number, d.project, d.team,
            d.week_ending::text, d.deduction_note, d.resolution_status,
            d.ticket_id, t.ticket_uid, d.created_at::text
       FROM ft_billing_deductions d
       LEFT JOIN maintenance_tickets t ON t.id = d.ticket_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.week_ending DESC, d.dr_number
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map((r): Item => ({
    source: 'deduction',
    sourceId: r.id,
    drNumber: r.dr_number,
    serial: r.serial_number,
    project: r.project,
    team: r.team,
    weekEnding: r.week_ending,
    noteCode: r.deduction_note,
    summary: `${r.deduction_note.toUpperCase()} deduction on week ${r.week_ending}`,
    status: r.resolution_status,
    ticketId: r.ticket_id,
    ticketUid: r.ticket_uid,
    createdAt: r.created_at,
  }));
}

async function fetchPreProv(f: ItemFilters): Promise<Item[]> {
  const params: unknown[] = [];
  const clauses: string[] = [`(pp.resolution_status IS NULL OR pp.resolution_status <> 'activated')`];

  if (f.project) {
    params.push(f.project);
    clauses.push(`pp.project ILIKE $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    clauses.push(`(pp.serial_number ILIKE $${params.length} OR pp.resolved_drop_number ILIKE $${params.length})`);
  }

  params.push(f.limit);
  const limitIdx = params.length;
  params.push(f.offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<{
    id: string; serial_number: string; project: string | null;
    resolution_status: string | null; resolved_drop_number: string | null;
    ticket_id: string | null; ticket_uid: string | null; created_at: string;
  }>(
    `SELECT pp.id, pp.serial_number, pp.project, pp.resolution_status,
            pp.resolved_drop_number, pp.ticket_id, t.ticket_uid, pp.created_at::text
       FROM oes_pp_data pp
       LEFT JOIN maintenance_tickets t ON t.id = pp.ticket_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY pp.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map((r): Item => ({
    source: 'pre_prov',
    sourceId: r.id,
    drNumber: r.resolved_drop_number,
    serial: r.serial_number,
    project: r.project,
    team: null,
    weekEnding: null,
    noteCode: null,
    summary: `Pre-provisioned ${r.serial_number}${r.resolved_drop_number ? ` (→ ${r.resolved_drop_number})` : ''}`,
    status: r.resolution_status ?? 'not_found',
    ticketId: r.ticket_id,
    ticketUid: r.ticket_uid,
    createdAt: r.created_at,
  }));
}

async function fetchOltMismatch(f: ItemFilters): Promise<Item[]> {
  const params: unknown[] = [];
  const clauses: string[] = [`r.fix_status IN ('pending', 'investigating', 'rejected', 'needs_investigation')`];

  if (f.project) {
    params.push(f.project);
    clauses.push(`i.project ILIKE $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    clauses.push(`r.drop_number ILIKE $${params.length}`);
  }

  params.push(f.limit);
  const limitIdx = params.length;
  params.push(f.offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<{
    id: string; drop_number: string; olt_serial: string | null; onemap_serial: string | null;
    project: string | null; fix_status: string; created_at: string;
  }>(
    `SELECT r.id, r.drop_number, r.olt_serial, r.wrong_onemap_serial AS onemap_serial,
            i.project, r.fix_status, r.created_at::text
       FROM olt_mismatch_records r
       LEFT JOIN olt_report_imports i ON i.id = r.import_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map((r): Item => ({
    source: 'olt_mismatch',
    sourceId: r.id,
    drNumber: r.drop_number,
    serial: r.olt_serial,
    project: r.project,
    team: null,
    weekEnding: null,
    noteCode: null,
    summary: `OLT serial ≠ 1Map (OLT: ${r.olt_serial ?? '?'} / 1Map: ${r.onemap_serial ?? '?'})`,
    status: r.fix_status,
    ticketId: null,
    ticketUid: null,
    createdAt: r.created_at,
  }));
}

async function fetchOffline(f: ItemFilters): Promise<Item[]> {
  const params: unknown[] = [];
  const clauses: string[] = [`o.mismatch_status IS NULL OR o.mismatch_status <> 'resolved'`];

  if (f.search) {
    params.push(`%${f.search}%`);
    clauses.push(`(o.drop_number ILIKE $${params.length} OR o.serial_number ILIKE $${params.length})`);
  }

  params.push(f.limit);
  const limitIdx = params.length;
  params.push(f.offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<{
    id: string; drop_number: string | null; serial_number: string | null;
    mismatch_status: string | null; created_at: string;
  }>(
    `SELECT o.id, o.drop_number, o.serial_number, o.mismatch_status,
            o.created_at::text
       FROM offline_devices o
      WHERE (${clauses.join(' OR ')})
      ORDER BY o.created_at DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map((r): Item => ({
    source: 'offline',
    sourceId: r.id,
    drNumber: r.drop_number,
    serial: r.serial_number,
    project: null,
    team: null,
    weekEnding: null,
    noteCode: null,
    summary: `Offline device ${r.serial_number ?? '?'}`,
    status: r.mismatch_status ?? 'offline',
    ticketId: null,
    ticketUid: null,
    createdAt: r.created_at,
  }));
}

export default withAuth(handler);
