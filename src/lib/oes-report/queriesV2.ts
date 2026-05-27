/**
 * OES Report Queries — ONT_LIFECYCLE_V2
 *
 * These query functions and interfaces are only used when the
 * `ONT_LIFECYCLE_V2` feature flag is enabled. They implement the correct
 * one-way ONT lifecycle model:
 *
 *   not_activated_yet → activated → (explicit fault/swap) → decommissioned
 *
 * The four functions replace the legacy loadPpData / loadFtDisputeRows with
 * four purpose-built query functions that give a precise operational picture:
 *
 *  1. loadPpNotFoundRows        — truly lost ONTs (no DR link from any source)
 *  2. loadPpLinkedAwaitingRows  — DR-linked but no OLT-Active confirmation yet
 *  3. loadFtDisputeDefiniteRows — OLT-Active AND on PP (strict overlap)
 *  4. loadFtDisputeLifecycleRows— ever activated, no decommission, on PP
 *
 * Root cause fixed by these queries: the old loadFtDisputeRows joined
 * oes_activations without filtering to the LATEST activation event, so
 * swapped-out serials with any historical Active row were counted as
 * current disputes (211 vs the physical-source-truth 22 on 2026-05-21).
 */

import { pool } from '@/lib/db';

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * PP rows where the serial has never been linked to a DR from any source.
 * These are truly lost ONTs — recovery targets.
 */
export interface NotFoundRow {
  project: string | null;
  serial_number: string | null;
  date_registered: string | null;
}

/**
 * PP rows that have DR linkage (from any source) but no OLT-Active confirmation.
 * These are "found but not yet live" serials — waiting for activation to propagate.
 */
export interface LinkedAwaitingRow {
  project: string | null;
  serial_number: string | null;
  date_registered: string | null;
  resolution_status: string | null;
  resolved_drop_number: string | null;
  resolved_source: string | null;
  linked_via: string[];
}

/**
 * FT Dispute — Definite: PP serial whose LATEST oes_activations row shows
 * status='Active'. This is the strict physical-source-truth definition.
 * A serial that has been swapped out (latest activation Inactive) is excluded.
 */
export interface FtDisputeDefiniteRow {
  serial_number: string;
  project: string | null;
  date_registered: string | null;
  drop_number: string;
  activation_date: string | null;
  team: string | null;
  activation_status: string | null;
}

/**
 * FT Dispute — Lifecycle: PP serial that has ever been activated
 * (activated_at IS NOT NULL, decommissioned_at IS NULL) but whose latest
 * oes_activations row is NOT currently Active (disjoint from Definite set).
 */
export interface FtDisputeLifecycleRow {
  serial_number: string | null;
  project: string | null;
  date_registered: string | null;
  drop_number: string | null;
  activated_at: string | null;
  resolved_source: string | null;
}

// ── Query functions ───────────────────────────────────────────────────────────

/**
 * Truly-unlinked PP serials from the latest batch per project.
 * resolution_status = 'not_found' AND linked_via = '{}'.
 * These are serials FibreFlow has no DR record for — genuine recovery targets.
 */
export async function loadPpNotFoundRows(): Promise<NotFoundRow[]> {
  const result = await pool.query<NotFoundRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.project, p.serial_number, p.date_registered::text
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    WHERE p.resolution_status = 'not_found'
      AND p.linked_via = '{}'
    ORDER BY p.project NULLS LAST, p.date_registered NULLS LAST, p.serial_number
  `);
  return result.rows;
}

/**
 * PP serials with DR linkage but no OLT-Active confirmation (activated_at IS NULL).
 * Includes all located_* statuses and any row where linked_via is non-empty.
 * These have a known DR but the activation event hasn't been observed in OES yet.
 */
export async function loadPpLinkedAwaitingRows(): Promise<LinkedAwaitingRow[]> {
  const result = await pool.query<LinkedAwaitingRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.project, p.serial_number, p.date_registered::text,
           p.resolution_status, p.resolved_drop_number, p.resolved_source,
           COALESCE(p.linked_via, '{}') AS linked_via
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    WHERE (
      -- Actual oes_pp_data status values are located_1map / located_local /
      -- located_unified. (located_oes / located_onemap kept for forward-compat.)
      p.resolution_status IN ('located_1map', 'located_local', 'located_unified', 'located_oes', 'located_onemap')
      OR cardinality(p.linked_via) > 0
    )
      AND p.resolution_status != 'not_found'
      AND p.activated_at IS NULL
    ORDER BY p.project NULLS LAST, p.date_registered NULLS LAST, p.serial_number
  `);
  return result.rows;
}

/**
 * PP serials from the latest batch that are ALREADY activated but still appear
 * on Fibertime's pre-provision list (resolution_status = 'activated'). These
 * should have been removed from the PP list once activated, so they are shown
 * on the PP — Linked sheet highlighted. They also appear in the FT Dispute tabs;
 * this is intentional so the PP list reconciles to the full tab count.
 */
export async function loadPpActivatedOnListRows(): Promise<LinkedAwaitingRow[]> {
  const result = await pool.query<LinkedAwaitingRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.project, p.serial_number, p.date_registered::text,
           p.resolution_status, p.resolved_drop_number, p.resolved_source,
           COALESCE(p.linked_via, '{}') AS linked_via
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    WHERE p.resolution_status = 'activated'
    ORDER BY p.project NULLS LAST, p.date_registered NULLS LAST, p.serial_number
  `);
  return result.rows;
}

/**
 * FT Dispute — Definite: PP serials from the latest batch whose single latest
 * oes_activations row (by activation_datetime/date DESC) has status='Active'.
 *
 * Serial-swap detection: if the most recent activation event for a serial is
 * Inactive, the serial is excluded even if older rows were Active.
 *
 * Uses DISTINCT ON so each serial contributes at most one activation row,
 * selecting the chronologically latest event.
 */
export async function loadFtDisputeDefiniteRows(): Promise<FtDisputeDefiniteRow[]> {
  const result = await pool.query<FtDisputeDefiniteRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    ),
    latest_activation AS (
      SELECT DISTINCT ON (LOWER(serial_number))
             serial_number, drop_number, activation_date, team, status
      FROM oes_activations
      WHERE serial_number IS NOT NULL
      ORDER BY LOWER(serial_number),
               activation_datetime DESC NULLS LAST,
               activation_date DESC NULLS LAST
    )
    SELECT p.serial_number, p.project, p.date_registered::text,
           la.drop_number, la.activation_date::text, la.team,
           la.status AS activation_status
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    JOIN latest_activation la
      ON LOWER(la.serial_number) = LOWER(p.serial_number)
    WHERE LOWER(la.status) = 'active'
    ORDER BY la.activation_date DESC NULLS LAST, p.project
  `);
  return result.rows;
}

/**
 * FT Dispute — Lifecycle: PP serials that have ever been activated
 * (activated_at IS NOT NULL, decommissioned_at IS NULL) but whose latest
 * oes_activations row is NOT currently Active (disjoint from the Definite set).
 *
 * These are serials that went live, then went offline or got swapped, with
 * no formal decommission event recorded in FibreFlow. They represent a
 * broader "may still be disputed" population beyond the strict OLT-Active set.
 */
export async function loadFtDisputeLifecycleRows(): Promise<FtDisputeLifecycleRow[]> {
  const result = await pool.query<FtDisputeLifecycleRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    ),
    latest_activation AS (
      SELECT DISTINCT ON (LOWER(serial_number))
             serial_number, status
      FROM oes_activations
      WHERE serial_number IS NOT NULL
      ORDER BY LOWER(serial_number),
               activation_datetime DESC NULLS LAST,
               activation_date DESC NULLS LAST
    )
    SELECT p.serial_number, p.project, p.date_registered::text,
           p.resolved_drop_number AS drop_number,
           p.activated_at::text AS activated_at,
           p.resolved_source
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    WHERE p.activated_at IS NOT NULL
      AND p.decommissioned_at IS NULL
      -- Exclude rows in the Definite set (latest activation is Active)
      AND NOT EXISTS (
        SELECT 1 FROM latest_activation la
        WHERE LOWER(la.serial_number) = LOWER(p.serial_number)
          AND LOWER(la.status) = 'active'
      )
    ORDER BY p.activated_at DESC NULLS LAST, p.project
  `);
  return result.rows;
}
