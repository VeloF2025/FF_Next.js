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
 * Pure helpers + types live in ./waNoOesTicketHelpers (re-exported here).
 *
 * @module data-sync/services/waNoOesTicketService
 */

import { pool as defaultPool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { createTicket, logTicketActivity } from '@/modules/noc/services/ticketService';
import { lookupOesGps } from '@/modules/noc/services/ticketGpsService';
import {
  CLOSED_STATUSES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildWaNoOesPayload,
  buildWaNoOesTitle,
  clampSinceDays,
  isUniqueViolation,
  partitionForCreation,
  type QueryableDb,
  type WaNoOesCandidate,
  type WaNoOesRunResult,
  type WaNoOesScope,
} from './waNoOesTicketHelpers';

// Re-export the public surface so existing importers/tests keep one entry point.
export {
  buildWaNoOesDescription,
  buildWaNoOesPayload,
  buildWaNoOesTitle,
  clampSinceDays,
  partitionForCreation,
} from './waNoOesTicketHelpers';
export type {
  QueryableDb,
  WaNoOesCandidate,
  WaNoOesScope,
  WaNoOesRunResult,
} from './waNoOesTicketHelpers';

/** wa_no_oes DRs joined to their real project + resolved Activations team. */
export async function fetchCandidates(
  db: QueryableDb,
  scope: WaNoOesScope
): Promise<WaNoOesCandidate[]> {
  const limit = Math.min(Math.max(1, Math.trunc(scope.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const sinceDays = clampSinceDays(scope.sinceDays);
  const { rows } = await db.query<WaNoOesCandidate>(
    `SELECT
        l.drop_number,
        l.project,
        p.id::text              AS project_id,
        act.team_id::text       AS activations_team_id,
        l.wa_submitted_at::text AS wa_submitted_at,
        l.wa_serial,
        l.wa_serial_source,
        d.design_lat,
        d.design_lng
       FROM v_dr_reconciliation_ledger l
       JOIN projects p ON LOWER(p.project_name) = LOWER(l.project)
       -- Design (SOW/1Map) position. wa_no_oes means the OES report has no row
       -- for this DR by definition, so this is normally the only coordinate
       -- available — these tickets previously shipped with none at all.
       --
       -- LATERAL ... LIMIT 1, not a plain LEFT JOIN. drops is UNIQUE on
       -- (project_id, drop_number), not drop_number alone, so the same DR under
       -- two project_ids is schema-legal. None exist today (checked), but a
       -- plain join would emit one candidate per drops row and inflate both the
       -- scanned count and the create attempts for that DR.
       LEFT JOIN LATERAL (
         SELECT dd.latitude::text AS design_lat, dd.longitude::text AS design_lng
           FROM drops dd
          WHERE dd.drop_number = l.drop_number
            AND dd.latitude IS NOT NULL AND dd.longitude IS NOT NULL
          ORDER BY dd.updated_at DESC NULLS LAST, dd.id DESC
          LIMIT 1
       ) d ON TRUE
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
        -- NULL wa_submitted_at is kept in-window: has_wa_submission and
        -- wa_submitted_at derive from different sources and can diverge.
        AND ($2::int IS NULL
             OR l.wa_submitted_at IS NULL
             OR l.wa_submitted_at >= NOW() - make_interval(days => $2::int))
      ORDER BY l.wa_submitted_at DESC NULLS LAST, l.drop_number
      LIMIT $3::int`,
    [scope.projectName ?? null, sinceDays, limit]
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

/**
 * Resolve open wa_no_oes tickets whose DR has since gained an OES activation.
 * Note: this covers the *activation* exit only. A DR that drifts to
 * serial_other_dr without activating (has_oes_activation stays false) keeps its
 * open ticket — defensible, since the install is genuinely still not activated.
 */
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
  // logTicketActivity swallows its own errors, so the fan-out can't break resolve.
  await Promise.all(
    rows.map((r) =>
      logTicketActivity({
        ticketId: r.id,
        activityType: 'status_change',
        description: `Auto-resolved: DR ${r.dr_number} now has an OES activation.`,
        userName: 'System (wa_no_oes)',
        userEmail: 'system@fibreflow.app',
      })
    )
  );
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
      // DR lookup is near-certain to miss (wa_no_oes = no OES row for this DR);
      // the serial fallback is what earns its keep here.
      const oesGps = await lookupOesGps(c.drop_number, c.wa_serial);
      await create(buildWaNoOesPayload(c, oesGps));
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
