/**
 * GET /api/activate/non-invoiceables/items
 *
 * Unified paginated list of non-invoiceable items from 4 source tables:
 *   1. oes_pp_data          → pre_provision
 *   2. olt_mismatch_records → serial_mismatch
 *   3. offline_devices (serial_mismatch=true) → serial_mismatch
 *   4. offline_devices (non-mismatch)         → offline
 *
 * Each source is queried separately, results are merged in JS, sorted by
 * days_open DESC, then paginated. NO conditional SQL template fragments.
 *
 * // 🟢 WORKING: explicit parameterised query branches, no conditional SQL
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import type {
  NonInvoiceableItem,
  NonInvoiceableCategory,
  ActionStatus,
  NonInvoiceableItemsResponse,
} from '@/modules/non-invoiceables/types';

const logger = createLogger('api/activate/non-invoiceables/items');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const daysOpen = (d: string | null) =>
  d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)) : 0;

const qs = (v: string | string[] | undefined): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : undefined;
  return s || undefined;
};

/** Build parameterised WHERE clauses without conditional SQL template fragments. */
function buildWhere(opts: {
  projectCol: string;
  dropCol: string | null;
  ticketCol: string | null;
  project?: string;
  search?: string;
  hasTicket?: boolean;
  extraFixed: string[];
}): { sql: string; params: unknown[] } {
  const clauses = [...opts.extraFixed];
  const params: unknown[] = [];

  if (opts.project) {
    params.push(`%${opts.project}%`);
    clauses.push(`${opts.projectCol} ILIKE $${params.length}`);
  }
  if (opts.search && opts.dropCol) {
    params.push(`%${opts.search}%`);
    clauses.push(`${opts.dropCol} ILIKE $${params.length}`);
  }
  if (opts.hasTicket === true  && opts.ticketCol) clauses.push(`${opts.ticketCol} IS NOT NULL`);
  if (opts.hasTicket === false && opts.ticketCol) clauses.push(`${opts.ticketCol} IS NULL`);

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Null-safe number from a Postgres string column. */
const n = (v: unknown): number => parseInt(String(v ?? '0'), 10) || 0;

// ─── Base item factory — fills all nullable fields with their zero values ─────

function base(overrides: Partial<NonInvoiceableItem> & Pick<NonInvoiceableItem,
  'id' | 'dr_number' | 'project' | 'category' | 'source' | 'action_status' | 'first_detected'
>): NonInvoiceableItem {
  return {
    oes_serial: null, olt_serial: null, onemap_serial: null,
    wa_serial: null, offline_serial: null, signal_dbm: null,
    offline_bucket: null, last_down_reason: null,
    pp_resolution_status: null, olt_fix_status: null,
    ticket_id: null, ticket_uid: null, ticket_status: null,
    billing_deduction_count: 0, last_deducted_week: null, deduction_note: null,
    zone: null, team: null,
    days_open: daysOpen(overrides.first_detected),
    ...overrides,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const project  = qs(req.query.project);
  const search   = qs(req.query.search);
  const catFilter = qs(req.query.category) as NonInvoiceableCategory | undefined;
  const actFilter = qs(req.query.action_status) as ActionStatus | undefined;
  const raw = req.query as Record<string, string | undefined>;
  const page  = Math.max(1, parseInt(raw.page  ?? '1',  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(raw.limit ?? '50', 10) || 50));
  const hasTicketRaw = qs(req.query.has_ticket);
  const hasTicket =
    hasTicketRaw === 'true' ? true : hasTicketRaw === 'false' ? false : undefined;

  try {
    const queries: Promise<NonInvoiceableItem[]>[] = [];

    // ── 1. Pre-provisions ─────────────────────────────────────────────────────
    if (!catFilter || catFilter === 'pre_provision') {
      const { sql: w, params } = buildWhere({
        projectCol: 'pp.project', dropCol: 'pp.serial_number',
        ticketCol: 'pp.maintenance_ticket_id',
        project, search, hasTicket,
        extraFixed: ["pp.resolution_status != 'activated'"],
      });
      queries.push(
        pool.query(
          `SELECT pp.id, pp.serial_number, pp.project, pp.resolution_status,
                  pp.maintenance_ticket_id, pp.created_at, pp.registered_date,
                  mt.ticket_uid AS ticket_uid, mt.status AS ticket_status,
                  oa.serial_number AS oes_serial,
                  (SELECT COUNT(*) FROM ft_billing_deductions bd
                   WHERE bd.dr_number = pp.serial_number AND bd.deduction_note = 'note4') AS billing_count,
                  (SELECT MAX(bd.week_ending) FROM ft_billing_deductions bd
                   WHERE bd.dr_number = pp.serial_number) AS last_billed
           FROM oes_pp_data pp
           LEFT JOIN maintenance_tickets mt ON mt.id = pp.maintenance_ticket_id
           LEFT JOIN oes_activations oa ON oa.serial_number = pp.serial_number
           ${w}`, params,
        ).then(({ rows }) => rows.map((r) => {
          const first = String(r.registered_date ?? r.created_at);
          const status: ActionStatus = r.maintenance_ticket_id
            ? 'ticketed' : r.resolution_status === 'not_found' ? 'open' : 'in_progress';
          return base({
            id: `oes_pp_data:${r.id}`, dr_number: r.serial_number, project: r.project,
            category: 'pre_provision', source: 'oes_pp_data',
            action_status: status, first_detected: first,
            oes_serial: r.oes_serial ?? null,
            ticket_id: r.maintenance_ticket_id ?? null,
            ticket_uid: r.ticket_uid ?? null, ticket_status: r.ticket_status ?? null,
            pp_resolution_status: r.resolution_status ?? null,
            billing_deduction_count: n(r.billing_count),
            last_deducted_week: r.last_billed ?? null, deduction_note: 'note4',
          });
        })),
      );
    }

    // ── 2 & 3. Serial mismatches (OLT + offline_devices mismatch) ────────────
    if (!catFilter || catFilter === 'serial_mismatch') {
      // 2a. olt_mismatch_records (no project col — JOIN through olt_report_imports)
      const { sql: w1, params: p1 } = buildWhere({
        projectCol: 'ri.project', dropCol: 'r.drop_number',
        ticketCol: 'r.maintenance_ticket_id',
        project, search, hasTicket,
        extraFixed: ["r.fix_status NOT IN ('fixed', 'resolved')"],
      });
      queries.push(
        pool.query(
          `SELECT r.id, r.drop_number, ri.project, r.olt_serial, r.wrong_onemap_serial,
                  r.fix_status, r.maintenance_ticket_id, r.created_at,
                  mt.ticket_uid AS ticket_uid, mt.status AS ticket_status,
                  oa.serial_number AS oes_serial, dr.ont_serial_scanned AS wa_serial, d.zone_no AS zone,
                  (SELECT COUNT(*) FROM ft_billing_deductions bd
                   WHERE bd.dr_number = r.drop_number AND bd.deduction_note = 'note4') AS billing_count,
                  (SELECT MAX(bd.week_ending) FROM ft_billing_deductions bd
                   WHERE bd.dr_number = r.drop_number AND bd.deduction_note = 'note4') AS last_billed
           FROM olt_mismatch_records r
           JOIN olt_report_imports ri ON ri.id = r.import_id
           LEFT JOIN maintenance_tickets mt ON mt.id = r.maintenance_ticket_id
           LEFT JOIN oes_activations oa ON oa.drop_number = r.drop_number
           LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = r.drop_number
           LEFT JOIN drops d ON d.drop_number = r.drop_number
           ${w1}`, p1,
        ).then(({ rows }) => rows.map((r) => base({
          id: `olt_mismatch:${r.id}`, dr_number: r.drop_number, project: r.project,
          category: 'serial_mismatch', source: 'olt_mismatch',
          action_status: r.maintenance_ticket_id ? 'ticketed' : 'open',
          first_detected: String(r.created_at),
          oes_serial: r.oes_serial ?? null, olt_serial: r.olt_serial ?? null,
          onemap_serial: r.wrong_onemap_serial ?? null, wa_serial: r.wa_serial ?? null,
          olt_fix_status: r.fix_status ?? null,
          ticket_id: r.maintenance_ticket_id ?? null,
          ticket_uid: r.ticket_uid ?? null, ticket_status: r.ticket_status ?? null,
          billing_deduction_count: n(r.billing_count),
          last_deducted_week: r.last_billed ?? null, deduction_note: 'note4',
          zone: r.zone ?? null,
        }))),
      );

      // 2b. offline_devices where serial_mismatch = true (no project col — get from drops→projects)
      const { sql: w2, params: p2 } = buildWhere({
        projectCol: 'p.project_name', dropCol: 'od.drop_number',
        ticketCol: 'od.mismatch_ticket_id',
        project, search, hasTicket,
        extraFixed: ["od.serial_mismatch = true", "od.mismatch_status != 'resolved'"],
      });
      queries.push(
        pool.query(
          `SELECT od.id, od.drop_number, COALESCE(p.project_name, 'Unknown') AS project,
                  od.serial_number AS offline_serial,
                  od.mismatch_status, od.mismatch_ticket_id, od.olt_serial, od.created_at,
                  od.last_down_reason, od.offline_bucket,
                  mt.ticket_uid AS ticket_uid, mt.status AS ticket_status,
                  oa.serial_number AS oes_serial, dr.ont_serial_scanned AS wa_serial, od.zone
           FROM offline_devices od
           LEFT JOIN maintenance_tickets mt ON mt.id = od.mismatch_ticket_id
           LEFT JOIN oes_activations oa ON oa.drop_number = od.drop_number
           LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = od.drop_number
           LEFT JOIN drops d ON d.drop_number = od.drop_number
           LEFT JOIN projects p ON p.id = d.project_id
           ${w2}`, p2,
        ).then(({ rows }) => rows.map((r) => {
          const status: ActionStatus =
            r.mismatch_status === 'ticket_created' ? 'ticketed'
            : r.mismatch_status === 'false_positive' ? 'false_positive'
            : 'open';
          return base({
            id: `offline_devices:${r.id}`, dr_number: r.drop_number, project: r.project,
            category: 'serial_mismatch', source: 'offline_devices',
            action_status: status, first_detected: String(r.created_at),
            oes_serial: r.oes_serial ?? null, olt_serial: r.olt_serial ?? null,
            wa_serial: r.wa_serial ?? null, offline_serial: r.offline_serial ?? null,
            offline_bucket: r.offline_bucket ?? null, last_down_reason: r.last_down_reason ?? null,
            ticket_id: r.mismatch_ticket_id ?? null,
            ticket_uid: r.ticket_uid ?? null, ticket_status: r.ticket_status ?? null,
            zone: r.zone ?? null,
          });
        })),
      );
    }

    // ── 4. Pure offline devices ───────────────────────────────────────────────
    if (!catFilter || catFilter === 'offline') {
      const { sql: w, params } = buildWhere({
        projectCol: 'p.project_name', dropCol: 'od.drop_number',
        ticketCol: null,
        project, search, hasTicket: undefined,
        extraFixed: ['od.serial_mismatch IS NOT TRUE'],
      });
      queries.push(
        pool.query(
          `SELECT od.id, od.drop_number, COALESCE(p.project_name, 'Unknown') AS project,
                  od.serial_number,
                  od.last_down_reason, od.offline_bucket, od.match_status, od.created_at,
                  oa.current_ont_rx AS signal_dbm, od.zone
           FROM offline_devices od
           LEFT JOIN oes_activations oa ON oa.drop_number = od.drop_number
           LEFT JOIN drops d ON d.drop_number = od.drop_number
           LEFT JOIN projects p ON p.id = d.project_id
           ${w}`, params,
        ).then(({ rows }) => rows.map((r) => base({
          id: `offline_devices:${r.id}`, dr_number: r.drop_number, project: r.project,
          category: 'offline', source: 'offline_devices',
          action_status: 'open', first_detected: String(r.created_at),
          offline_serial: r.serial_number ?? null, signal_dbm: r.signal_dbm ?? null,
          offline_bucket: r.offline_bucket ?? null, last_down_reason: r.last_down_reason ?? null,
          zone: r.zone ?? null,
        }))),
      );
    }

    const batches  = await Promise.all(queries);
    let items: NonInvoiceableItem[] = ([] as NonInvoiceableItem[]).concat(...batches);

    // Post-query JS filters (action_status; has_ticket for offline where no SQL ticketCol)
    if (actFilter) items = items.filter((i) => i.action_status === actFilter);
    if (hasTicket !== undefined && (!catFilter || catFilter === 'offline')) {
      items = items.filter((i) =>
        i.category !== 'offline' || (hasTicket ? i.ticket_id !== null : i.ticket_id === null),
      );
    }

    items.sort((a, b) => b.days_open - a.days_open);

    const total       = items.length;
    const total_pages = Math.ceil(total / limit) || 1;
    const pageItems   = items.slice((page - 1) * limit, page * limit);

    const response: NonInvoiceableItemsResponse = { items: pageItems, total, page, limit, total_pages };

    logger.info('items listed', { total, page, limit, category: catFilter ?? 'all', project: project ?? 'all' });
    return apiResponse.success(res, response);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load non-invoiceable items';
    logger.error('items GET failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler as Parameters<typeof withAuth>[0]);
