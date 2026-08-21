/**
 * Candidate selection, the aggregate coverage gate, and the pre-destruction
 * purgeability check for the retention pipeline (migration 518).
 *
 * Run and item state lives in `retentionRunRepository.ts`; this file decides
 * only WHICH incidents may be purged, never records what happened to them.
 *
 * Three properties are enforced here and re-enforced by the schema:
 *
 *   1. A candidate is terminal, past the cutoff, free of any ACTIVE hold, and
 *      not already claimed. `trg_fleet_retention_item_guard` re-checks the
 *      first two at claim time, so a hold raised between selection and claim
 *      makes the claim fail rather than the incident vanish.
 *   2. Nothing is claimed without complete aggregate coverage for its month.
 *      Detail may only disappear once the anonymous trend that replaces it
 *      exists.
 *   3. Progress is durable per item. A crash between storage deletion and the
 *      database transaction leaves a row that says exactly how far it got.
 *
 * There is deliberately no `SELECT ... FOR UPDATE` on the incident for the
 * purge/hold race: inserting a hold already takes an implicit FOR KEY SHARE
 * lock on the incident row through its foreign key, which conflicts with the
 * DELETE's lock (migration 518, invariant 2). Adding an application lock would
 * duplicate a guarantee the schema already gives.
 */
import { query, queryOne, transaction } from '@/lib/db-pool';

export interface PurgeCandidate {
  incidentId: string;
  /** SAST work date, falling back to the SAST date the incident was opened. */
  workDate: string;
  /** First day of that work date's month — the aggregate coverage key. */
  monthStart: string;
}

interface CandidateRow extends Record<string, unknown> {
  id: string; work_date: string | Date; month_start: string | Date;
}

interface CountRow extends Record<string, unknown> { total: string | number }

function isoDate(value: string | Date): string {
  // node-postgres parses DATE (OID 1082) into a local-midnight Date; slicing
  // toISOString() on that shifts the day. Format the local parts instead.
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * The effective work date of an incident, in SAST. `work_date` is authoritative
 * when present; `opened_at` is a timestamptz and must be read in SAST or an
 * incident opened at 01:00 SAST lands on the previous day.
 */
const EFFECTIVE_WORK_DATE =
  `COALESCE(i.work_date, (i.opened_at AT TIME ZONE 'Africa/Johannesburg')::date)`;

const ELIGIBILITY_PREDICATE = `
  i.lifecycle_status IN ('resolved', 'dismissed')
  AND ${EFFECTIVE_WORK_DATE} < $1::date
  AND NOT EXISTS (
    SELECT 1 FROM fleet_incident_retention_holds h
     WHERE h.incident_id = i.id AND h.status = 'active'
  )
  -- Another incident's 'duplicate' outcome points here. Deleting this row
  -- would strand that outcome, and the schema refuses to let the pointer be
  -- cleared on its own, so this incident waits until the one referencing it
  -- has been purged.
  AND NOT EXISTS (
    SELECT 1 FROM fleet_operational_incidents d WHERE d.duplicate_incident_id = i.id
  )`;

/** Terminal, past the cutoff, unheld, unclaimed — oldest first, bounded by the configured batch size. */
export async function listPurgeCandidates(params: { cutoffWorkDate: string; limit: number }): Promise<PurgeCandidate[]> {
  const rows = await query<CandidateRow>(
    `/* fleet-retention:candidates */
     SELECT i.id, ${EFFECTIVE_WORK_DATE} AS work_date,
            date_trunc('month', ${EFFECTIVE_WORK_DATE})::date AS month_start
       FROM fleet_operational_incidents i
      WHERE ${ELIGIBILITY_PREDICATE}
        AND NOT EXISTS (
          SELECT 1 FROM fleet_operational_retention_items it WHERE it.incident_id = i.id
        )
      ORDER BY work_date ASC, i.id ASC
      LIMIT $2::int`,
    [params.cutoffWorkDate, params.limit],
  );
  return rows.map((row) => ({
    incidentId: row.id, workDate: isoDate(row.work_date), monthStart: isoDate(row.month_start),
  }));
}

/** How many otherwise-eligible incidents are being kept by an active hold — reported, never purged. */
export async function countCandidatesHeld(params: { cutoffWorkDate: string }): Promise<number> {
  const rows = await query<CountRow>(
    `/* fleet-retention:held */
     SELECT COUNT(*) AS total FROM fleet_operational_incidents i
      WHERE i.lifecycle_status IN ('resolved', 'dismissed')
        AND ${EFFECTIVE_WORK_DATE} < $1::date
        AND EXISTS (
          SELECT 1 FROM fleet_incident_retention_holds h
           WHERE h.incident_id = i.id AND h.status = 'active'
        )`,
    [params.cutoffWorkDate],
  );
  return Number(rows[0]?.total ?? 0);
}

export type IncidentPurgeState = 'purgeable' | 'held' | 'not_terminal' | 'missing';

interface PurgeStateRow extends Record<string, unknown> {
  lifecycle_status: string;
  has_active_hold: boolean;
}

/**
 * Re-checks, immediately before anything destructive, whether an incident may
 * still be purged.
 *
 * WHY THIS EXISTS. `claimIncident` is guarded by the schema, but the claim
 * COMMITS and storage deletion then happens over HTTP, outside any
 * transaction. A hold raised in that window would otherwise be discovered only
 * when the first bookkeeping UPDATE was refused — by which time an attachment
 * had already been destroyed, irreversibly, for an incident somebody had just
 * decided to keep.
 *
 * WHY IT TAKES A ROW LOCK, given the FK already serialises the purge/hold
 * race. That FK guarantee is about the incident DELETE, and it is not what is
 * at risk here: an HTTP call cannot be serialised by a database lock at all.
 * `FOR UPDATE` conflicts with the `FOR KEY SHARE` a hold insert takes, so this
 * check WAITS for a hold that is mid-commit instead of reading past it and
 * concluding "purgeable". That narrows the window from "any concurrent hold"
 * to "a hold that begins after this check commits".
 *
 * It does NOT eliminate that residual window, and no lock held only in the
 * database can: closing it fully means either holding a row lock across the
 * storage HTTP calls (which would block a manager placing a legal hold for the
 * duration of a batch) or having the hold service refuse while a purge is in
 * flight. Both are design changes, not fixes, and neither is in this change.
 */
export async function getIncidentPurgeState(incidentId: string): Promise<IncidentPurgeState> {
  return transaction(async (txn) => {
    const locked = await txn.queryOne<{ id: string }>(
      `/* fleet-retention:purge-state-lock */
       SELECT id FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`,
      [incidentId],
    );
    if (!locked) return 'missing';
    // A SECOND statement, deliberately. Under READ COMMITTED the lock above
    // makes us wait for an in-flight hold, but the snapshot the blocked
    // statement runs under predates that hold's commit — EvalPlanQual re-reads
    // the locked ROW, not a subquery against another table. Reading the holds
    // in a new statement takes a new snapshot, after the wait, so the hold is
    // visible. Merging these two queries back together silently reintroduces a
    // check that reports "purgeable" for an incident that was just held.
    const row = await txn.queryOne<PurgeStateRow>(
      `/* fleet-retention:purge-state */
       SELECT i.lifecycle_status,
              EXISTS (
                SELECT 1 FROM fleet_incident_retention_holds h
                 WHERE h.incident_id = i.id AND h.status = 'active'
              ) AS has_active_hold
         FROM fleet_operational_incidents i
        WHERE i.id = $1::uuid`,
      [incidentId],
    );
    if (!row) return 'missing';
    if (row.has_active_hold) return 'held';
    if (row.lifecycle_status !== 'resolved' && row.lifecycle_status !== 'dismissed') return 'not_terminal';
    return 'purgeable';
  });
}

export interface IncidentStorageObject {
  evidenceId: string;
  /** The stored `storage_key`; `storage_url` is the fallback for older rows. */
  storagePath: string;
}

interface EvidenceRow extends Record<string, unknown> { id: string; storage_key: string; storage_url: string }

export async function listIncidentStorageObjects(incidentId: string): Promise<IncidentStorageObject[]> {
  const rows = await query<EvidenceRow>(
    `/* fleet-retention:storage-objects */
     SELECT id, storage_key, storage_url FROM fleet_operational_incident_evidence
      WHERE incident_id = $1::uuid ORDER BY created_at ASC, id ASC`,
    [incidentId],
  );
  return rows.map((row) => ({ evidenceId: row.id, storagePath: row.storage_key || row.storage_url }));
}

/**
 * The coverage gate. Identifiable detail may only be deleted once the
 * anonymous monthly aggregate that replaces it exists and is active for the
 * metric version in force.
 */
export async function hasCompleteAggregateCoverage(monthStart: string, metricVersion: number): Promise<boolean> {
  const row = await queryOne<CountRow>(
    `/* fleet-retention:coverage */
     SELECT COUNT(*) AS total FROM fleet_operational_monthly_aggregates
      WHERE month_start = $1::date AND metric_version = $2::int AND is_active = true`,
    [monthStart, metricVersion],
  );
  return Number(row?.total ?? 0) > 0;
}
