/**
 * waNoOesTicketService — turn DRs submitted on WhatsApp but never activated
 * (v_dr_reconciliation_ledger.recon_class = 'wa_no_oes') into auto-assigned
 * `activations` NOC tickets, and auto-resolve them once the DR later activates
 * (audit rec #5, part B).
 *
 * Routing: assigned to the project's Activations team
 * (project_team_assignments.role = 'activations'), mirroring pp_data / olt_mismatch.
 * teams.discipline is unpopulated live, so createTicket's discipline auto-assign is
 * a no-op — we resolve the team explicitly and pass assigned_team_id.
 *
 * Scope guard: the INNER JOIN to projects restricts to real projects (excludes
 * test/non-prod like Velo Test / Marketing that have no projects row).
 *
 * Idempotent: a pre-check skips DRs that already have an OPEN wa_no_oes ticket;
 * migration 417's partial unique index is the race backstop (23505 → skipped).
 * Driven by pages/api/cron/wa-no-oes-tickets.ts (decoupled from the OES report).
 *
 * @module data-sync/services/waNoOesTicketService
 */

import { pool as defaultPool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { createTicket, logTicketActivity } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
  type CreateTicketPayload,
} from '@/modules/noc/types/ticket';

/** system@fibreflow.app — the bot account authoring auto-created tickets. */
const SYSTEM_USER_ID =
  process.env.WA_BRIDGE_SYSTEM_USER_ID ?? '81abd560-48ae-414e-ad31-9d82f1a9ed49';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

/** Statuses that count as "no longer open" for dedup + auto-resolve. */
const CLOSED_STATUSES = ['resolved', 'closed', 'cancelled', 'verified'];

/** Minimal surface of pg.Pool this service needs — lets tests inject a fake. */
export interface QueryableDb {
  query<R extends Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: R[] }>;
}

export interface WaNoOesCandidate extends Record<string, unknown> {
  drop_number: string;
  project: string;
  /** resolved projects.id (uuid) — always present (INNER JOIN). */
  project_id: string;
  /** project Activations team uuid, or null when the project has none. */
  activations_team_id: string | null;
  wa_submitted_at: string | null;
  wa_serial: string | null;
  wa_serial_source: string | null;
}

export interface WaNoOesScope {
  /** restrict to a single project name (case-insensitive); null = all real projects. */
  projectName?: string | null;
  /** only DRs WA-submitted within this many days; null = no window (backfill). */
  sinceDays?: number | null;
  limit?: number;
}

export interface WaNoOesRunResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  /** of those created, how many had no Activations team (left unassigned). */
  unassigned: number;
  dryRun: boolean;
  preview?: Array<{
    drop_number: string;
    project: string;
    assigned_team_id: string | null;
    title: string;
  }>;
}

// ---- pure helpers (unit-tested) -------------------------------------------

export function buildWaNoOesTitle(dropNumber: string, project: string): string {
  return `WA install not activated — ${dropNumber} (${project})`;
}

export function buildWaNoOesDescription(c: WaNoOesCandidate): string {
  const lines = [
    `Drop ${c.drop_number} (project: ${c.project}) was submitted on WhatsApp but has no OES activation record.`,
  ];
  if (c.wa_submitted_at) {
    lines.push(`WA submitted: ${new Date(c.wa_submitted_at).toISOString().slice(0, 10)}`);
  }
  if (c.wa_serial) {
    lines.push(`WA serial (${c.wa_serial_source ?? 'unknown'} source): ${c.wa_serial}`);
  }
  lines.push(
    'Source: three-way recon ledger (recon_class = wa_no_oes). Auto-created by rec #5 part B.'
  );
  return lines.join('\n');
}

export function buildWaNoOesPayload(c: WaNoOesCandidate): CreateTicketPayload {
  const assigned = c.activations_team_id ?? undefined;
  return {
    source: TicketSource.WA_NO_OES,
    source_type: 'wa_no_oes',
    ticket_type: TicketType.ACTIVATIONS,
    title: buildWaNoOesTitle(c.drop_number, c.project),
    description: buildWaNoOesDescription(c),
    priority: TicketPriority.NORMAL,
    dr_number: c.drop_number,
    project_id: c.project_id,
    created_by: SYSTEM_USER_ID,
    assigned_team_id: assigned,
    status: assigned ? TicketStatus.ASSIGNED : undefined,
  };
}

/** Split candidates into those to create vs skip (already have an open ticket). */
export function partitionForCreation(
  candidates: WaNoOesCandidate[],
  openDrs: Set<string>
): { toCreate: WaNoOesCandidate[]; skippedExisting: number } {
  const toCreate: WaNoOesCandidate[] = [];
  let skippedExisting = 0;
  for (const c of candidates) {
    if (openDrs.has(c.drop_number)) skippedExisting++;
    else toCreate.push(c);
  }
  return { toCreate, skippedExisting };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

// ---- DB I/O ---------------------------------------------------------------

/** wa_no_oes DRs joined to their real project + resolved Activations team. */
export async function fetchCandidates(
  db: QueryableDb,
  scope: WaNoOesScope
): Promise<WaNoOesCandidate[]> {
  const limit = Math.min(Math.max(1, Math.trunc(scope.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const { rows } = await db.query<WaNoOesCandidate>(
    `SELECT
        l.drop_number,
        l.project,
        p.id::text              AS project_id,
        act.team_id::text       AS activations_team_id,
        l.wa_submitted_at::text AS wa_submitted_at,
        l.wa_serial,
        l.wa_serial_source
       FROM v_dr_reconciliation_ledger l
       JOIN projects p ON LOWER(p.project_name) = LOWER(l.project)
       LEFT JOIN LATERAL (
         SELECT pta.team_id
           FROM project_team_assignments pta
           JOIN teams t ON t.id = pta.team_id AND t.is_active
          WHERE pta.project_id = p.id AND pta.role = 'activations'
          ORDER BY t.name
          LIMIT 1
       ) act ON TRUE
      WHERE l.recon_class = 'wa_no_oes'
        AND ($1::text IS NULL OR LOWER(l.project) = LOWER($1))
        AND ($2::int  IS NULL OR l.wa_submitted_at >= NOW() - make_interval(days => $2::int))
      ORDER BY l.wa_submitted_at DESC NULLS LAST, l.drop_number
      LIMIT $3::int`,
    [scope.projectName ?? null, scope.sinceDays ?? null, limit]
  );
  return rows;
}

/** Drop numbers that already carry an OPEN wa_no_oes ticket. */
export async function fetchOpenTicketDrs(
  db: QueryableDb,
  drs: string[]
): Promise<Set<string>> {
  if (drs.length === 0) return new Set();
  const { rows } = await db.query<{ dr_number: string }>(
    `SELECT DISTINCT dr_number
       FROM maintenance_tickets
      WHERE source = 'wa_no_oes'
        AND dr_number = ANY($1::text[])
        AND status <> ALL($2::text[])`,
    [drs, CLOSED_STATUSES]
  );
  return new Set(rows.map((r) => r.dr_number));
}

/** Resolve open wa_no_oes tickets whose DR has since gained an OES activation. */
export async function autoResolveWaNoOesTickets(
  db: QueryableDb = defaultPool
): Promise<number> {
  const { rows } = await db.query<{ id: string; dr_number: string }>(
    `UPDATE maintenance_tickets mt
        SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
      WHERE mt.source = 'wa_no_oes'
        AND mt.dr_number IS NOT NULL
        AND mt.status <> ALL($1::text[])
        AND EXISTS (
          SELECT 1 FROM v_dr_reconciliation_ledger l
           WHERE l.drop_number = mt.dr_number AND l.has_oes_activation = TRUE
        )
      RETURNING id, dr_number`,
    [CLOSED_STATUSES]
  );
  for (const r of rows) {
    await logTicketActivity({
      ticketId: r.id,
      activityType: 'status_change',
      description: `Auto-resolved: DR ${r.dr_number} now has an OES activation.`,
      userName: 'System (wa_no_oes)',
      userEmail: 'system@fibreflow.app',
    });
  }
  if (rows.length > 0) {
    log.info('wa_no_oes auto-resolve', { resolved: rows.length }, 'waNoOesTicketService');
  }
  return rows.length;
}

/**
 * Create tickets for eligible wa_no_oes DRs. dryRun returns the would-create list
 * without inserting. Used by both the nightly cron (forward window) and the gated
 * per-project backfill (no window, one project at a time).
 */
export async function runWaNoOesTickets(
  opts: WaNoOesScope & {
    dryRun?: boolean;
    db?: QueryableDb;
    createTicketFn?: typeof createTicket;
  } = {}
): Promise<WaNoOesRunResult> {
  const db = opts.db ?? defaultPool;
  const create = opts.createTicketFn ?? createTicket;

  const candidates = await fetchCandidates(db, opts);
  const openDrs = await fetchOpenTicketDrs(
    db,
    candidates.map((c) => c.drop_number)
  );
  const { toCreate, skippedExisting } = partitionForCreation(candidates, openDrs);

  if (opts.dryRun) {
    return {
      scanned: candidates.length,
      created: 0,
      skippedExisting,
      unassigned: toCreate.filter((c) => !c.activations_team_id).length,
      dryRun: true,
      preview: toCreate.map((c) => ({
        drop_number: c.drop_number,
        project: c.project,
        assigned_team_id: c.activations_team_id,
        title: buildWaNoOesTitle(c.drop_number, c.project),
      })),
    };
  }

  let created = 0;
  let unassigned = 0;
  let raceSkipped = 0;
  for (const c of toCreate) {
    try {
      await create(buildWaNoOesPayload(c));
      created++;
      if (!c.activations_team_id) unassigned++;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent writer (or the dedup index) already covers this DR.
        raceSkipped++;
        continue;
      }
      throw err;
    }
  }

  log.info(
    'wa_no_oes ticket run complete',
    {
      scope: opts.projectName ?? 'all',
      sinceDays: opts.sinceDays ?? null,
      scanned: candidates.length,
      created,
      skippedExisting: skippedExisting + raceSkipped,
      unassigned,
    },
    'waNoOesTicketService'
  );

  return {
    scanned: candidates.length,
    created,
    skippedExisting: skippedExisting + raceSkipped,
    unassigned,
    dryRun: false,
  };
}
