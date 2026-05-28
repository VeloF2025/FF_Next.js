/**
 * cascadeSerialPromotion.ts — Sprint E Track 2.4 helper
 *
 * Encapsulates the bulk metadata UPDATE (Step A) and per-row promoteSerial
 * loop (Step B) used by cascadePpResolution. Separated because the refactored
 * cascade + imports would exceed the 300-line service file limit.
 *
 * Contract:
 *   - Accepts a PoolClient already inside an open transaction (caller owns
 *     BEGIN/COMMIT/ROLLBACK — same pattern as cascadePpResolution.ts).
 *   - selectAndUpdateMetadataForCascade: CTE+UPDATE...RETURNING → candidate
 *     array (STEP A).  promoteCascadeCandidates: per-row status promotion
 *     loop (STEP B).
 *   - For candidates not in MATRIX_VALID_SOURCES (activated, installed, etc.)
 *     the Step A metadata UPDATE already ran; no further write is performed.
 *
 * Valid sources after mig 387 matrix extension:
 *   issued, in_stock, available, allocated_to_project
 *   See: scripts/migrations/sql/387_serial_lifecycle_state_machine.sql
 *
 * Design notes:
 *   - Metadata UPDATE (installed_at_drop_number, installed_date) runs as a
 *     bulk statement BEFORE the per-row loop so that cross-validation triggers
 *     see installed_at_drop_number already set when promoteSerial fires.
 *   - sourceTable is always 'oes_pp_data'; sourceId is the pp.id (integer) cast
 *     to string. The emit trigger stores it as uuid; oes_pp_data.id is SERIAL
 *     (integer), so we pass a nil-UUID placeholder to keep the uuid column happy
 *     while still namespacing events by sourceTable. The ppIdToUuid approach is
 *     intentional — see Gotcha 5 in the plan.
 *
 * Refs: docs/superpowers/plans/2026-05-28-serial-lifecycle-state-machine-sprintE.md
 */

import type { PoolClient } from 'pg';
import { promoteSerial } from '@/modules/procurement/field-stock/services/serialLifecycle';
import { log } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A resolved PP that has already received its metadata UPDATE. */
export interface CascadeCandidate {
  /** stock_serials.id (UUID) */
  serialId:      string;
  /** stock_serials.serial_number — for log context only */
  serialNumber:  string;
  /** stock_serials.status at the time of the SELECT (before metadata UPDATE) */
  currentStatus: string;
  /** pp.id (SERIAL integer, used as event sourceId reference) */
  ppId:          number;
  /** Drop number the PP resolved to (used in payload) */
  dropNumber:    string;
  /** Photo date from resolved_details (nullable, used in payload) */
  photoDate:     string | null;
}

/** Counts returned by promoteCascadeCandidates for result rollup. */
export interface CascadePromotionCounts {
  promoted:     number;   // rows promoted via promoteSerial
  metadataOnly: number;   // rows that got metadata-only (status unchanged)
}

// ─── Matrix-valid source states ────────────────────────────────────────────────

/**
 * States from which a transition to `installed` is in the mig 387 matrix.
 * After mig 387 matrix extension (Track 2.4):
 *   issued               — picking done, field install follows
 *   in_stock             — OES cascade: direct install (picking event missed)
 *   available            — OES cascade: legacy pre-backfill direct install
 *   allocated_to_project — OES cascade: direct install from project allocation
 */
const MATRIX_VALID_SOURCES = new Set<string>([
  'issued',
  'in_stock',
  'available',
  'allocated_to_project',
]);

// ─── Step A: bulk metadata UPDATE ─────────────────────────────────────────────

/**
 * CTE + bulk UPDATE that writes installed_at_drop_number / installed_date for
 * all eligible serials matched against newly-resolved oes_pp_data rows.
 *
 * WHY: stock_serials may key the inventory record by either the PP serial
 * (procurement source) or the photo serial (what was actually installed, when
 * VLM/OCR differs by 1 char). Prefer photo_serial when present — that's the
 * physical unit on the wall. Fall back to pp_serial. Only update one record per
 * resolution; if both rows happen to exist, the physical (photo) wins.
 *
 * status: only promote pre-install states. Already-activated serials get their
 * install metadata backfilled (so the install fact is captured), but their
 * status is NOT regressed from 'activated' — OES is the activation oracle, and
 * the lifecycle is one-way past activated.
 *
 * The ROW_NUMBER() OVER (PARTITION BY pp.id ORDER BY CASE WHEN serial_number =
 * photo_serial THEN 1 ... END) is the mechanism that enforces the photo_serial
 * preference: the photo-matched row gets rn=1 and is the only row updated.
 *
 * @param client      An open pg PoolClient — caller owns the transaction.
 * @param cutoffTime  Lower bound for pp.resolved_at — only newly-resolved PPs
 *                    are touched (passed from cascadePpResolution caller).
 * @returns           Candidate array ready for the Step B promotion loop.
 */
export async function selectAndUpdateMetadataForCascade(
  client:      PoolClient,
  cutoffTime:  Date,
): Promise<CascadeCandidate[]> {
  const metadataUpdate = await client.query(
    `
    WITH ranked AS (
      SELECT ss.id          AS serial_id,
             ss.serial_number,
             ss.status      AS current_status,
             pp.id          AS pp_id,
             pp.resolved_drop_number,
             (pp.resolved_details->>'photo_date')::date AS photo_date,
             ROW_NUMBER() OVER (
               PARTITION BY pp.id
               ORDER BY CASE
                 WHEN ss.serial_number = pp.resolved_details->>'photo_serial' THEN 1
                 WHEN ss.serial_number = pp.serial_number THEN 2
                 ELSE 3
               END
             ) AS rn
      FROM oes_pp_data pp
      JOIN stock_serials ss
        ON ss.serial_number IN (pp.serial_number, COALESCE(pp.resolved_details->>'photo_serial', pp.serial_number))
      WHERE pp.resolved_at >= $1
        AND pp.resolved_drop_number IS NOT NULL
        AND ss.installed_at_drop_number IS NULL
    )
    UPDATE stock_serials ss
    SET installed_at_drop_number = r.resolved_drop_number,
        installed_date = COALESCE(r.photo_date, CURRENT_DATE),
        updated_at = NOW()
    FROM ranked r
    WHERE ss.id = r.serial_id
      AND r.rn = 1
      AND ss.installed_at_drop_number IS NULL
    RETURNING
      ss.id          AS serial_id,
      ss.serial_number,
      ss.status      AS current_status,
      r.pp_id        AS pp_id,
      r.resolved_drop_number AS drop_number,
      r.photo_date::text     AS photo_date
    `,
    [cutoffTime.toISOString()],
  );

  return metadataUpdate.rows.map((r) => ({
    serialId:      r.serial_id     as string,
    serialNumber:  r.serial_number as string,
    currentStatus: r.current_status as string,
    ppId:          Number(r.pp_id),
    dropNumber:    r.drop_number   as string,
    photoDate:     r.photo_date    as string | null,
  }));
}
// ─── Step B: per-row status promotion ─────────────────────────────────────────

/**
 * For each candidate, call promoteSerial (status + event) when the source
 * state is matrix-valid. Skip already-installed/activated states (metadata
 * was already updated by the bulk UPDATE; no event is appropriate).
 *
 * @param client      An open pg PoolClient — caller owns the transaction.
 * @param candidates  Resolved PP serials with their pre-UPDATE status.
 * @param cutoffTime  Stored on each emitted stock_serial_events.payload as
 *                    `cutoff_time` for forensic audit, plus included in the
 *                    cascade summary log.
 */
export async function promoteCascadeCandidates(
  client:      PoolClient,
  candidates:  CascadeCandidate[],
  cutoffTime:  Date,
): Promise<CascadePromotionCounts> {
  let promoted     = 0;
  let metadataOnly = 0;

  for (const c of candidates) {
    if (MATRIX_VALID_SOURCES.has(c.currentStatus)) {
      // Status promotion: call promoteSerial so the mig 387 trigger emits an
      // audited stock_serial_events row. Client is a PoolClient with `release`
      // — promoteSerial detects this and skips its own BEGIN/COMMIT.
      await promoteSerial(client, {
        serialId:    c.serialId,
        toStatus:    'installed',
        toHolderId:  null,          // customer's drop — no tracked holder
        sourceTable: 'oes_pp_data',
        // sourceId must be a UUID. oes_pp_data.id is an integer; we encode it
        // as a deterministic zero-prefixed UUID so events are queryable by
        // source. Collision probability is zero within oes_pp_data.
        sourceId: ppIdToUuid(c.ppId),
        actorStaffId: null,         // system-triggered cascade, no user actor
        payload: {
          cutoff_time: cutoffTime.toISOString(),
          photo_date:  c.photoDate ?? null,
          drop_number: c.dropNumber,
        },
      });
      promoted++;
      log.debug('cascade promoted serial', {
        serialNumber: c.serialNumber,
        fromStatus:   c.currentStatus,
        dropNumber:   c.dropNumber,
      });
    } else {
      // activated, installed, faulty, returned, scrapped:
      // Metadata (installed_at_drop_number, installed_date) was already set
      // by the bulk UPDATE that preceded this helper. No status change; no event.
      metadataOnly++;
      log.debug('cascade metadata-only (status protected)', {
        serialNumber:  c.serialNumber,
        currentStatus: c.currentStatus,
        dropNumber:    c.dropNumber,
      });
    }
  }

  return { promoted, metadataOnly };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode integer oes_pp_data.id into a UUID-shaped string for storage in
 * stock_serial_events.source_id (which is uuid-typed).
 *
 * Encoding: zero-pad the decimal integer to 12 chars and place it in the
 * trailing segment of an otherwise all-zero UUID:
 *   ppId 42 → '00000000-0000-0000-0000-000000000042'
 *
 * Safety:
 *   - oes_pp_data.id is INT4 (PG SERIAL); max value 2,147,483,647 (10 digits)
 *     fits comfortably in the 12-char trailing segment.
 *   - Decimal digits 0-9 ARE valid hex chars — pg's uuid type accepts them.
 *
 * Reversal: parse the trailing 12 chars as a base-10 integer.
 *
 * Limitations:
 *   - NOT namespaced. If another source_table ever adopts the same trick,
 *     collisions are possible across source_table values. This is acceptable
 *     today because only the cascade uses this encoding. Future-work: add a
 *     real `source_integer_id` column to stock_serial_events to retire this.
 */
function ppIdToUuid(ppId: number): string {
  return `00000000-0000-0000-0000-${String(ppId).padStart(12, '0')}`;
}
