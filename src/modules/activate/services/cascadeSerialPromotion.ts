/**
 * cascadeSerialPromotion.ts — Sprint E Track 2.4 helper
 *
 * Encapsulates the per-row promoteSerial loop used by cascadePpResolution.
 * Separated because the refactored cascade + imports would exceed the 300-line
 * service file limit.
 *
 * Contract:
 *   - Accepts a PoolClient already inside an open transaction (caller owns
 *     BEGIN/COMMIT/ROLLBACK — same pattern as cascadePpResolution.ts).
 *   - For each candidate whose `currentStatus` is a matrix-valid source for
 *     the `(*, installed)` transition, calls promoteSerial(client, ...).
 *   - For all other candidates (activated, installed, faulty, returned,
 *     scrapped) the metadata UPDATE that precedes this call already ran in the
 *     parent; no additional write is performed here.
 *
 * Valid sources after mig 387 matrix extension:
 *   issued, in_stock, available, allocated_to_project
 *   See: scripts/migrations/sql/387_serial_lifecycle_state_machine.sql
 *
 * Design notes:
 *   - Metadata UPDATE (installed_at_drop_number, installed_date) runs as a
 *     bulk statement in cascadePpResolution BEFORE this helper is called so
 *     that cross-validation triggers see the installed_at_drop_number already
 *     set when promoteSerial fires.
 *   - sourceTable is always 'oes_pp_data'; sourceId is the pp.id (integer) cast
 *     to string. The emit trigger stores it as uuid; oes_pp_data.id is SERIAL
 *     (integer), so we pass a nil-UUID placeholder to keep the uuid column happy
 *     while still namespacing events by sourceTable. The FAKE_PP_UUID approach
 *     is intentional — see Gotcha 5 in the plan: sourceId ← pp.id, but the
 *     column is uuid so we encode as a deterministic nil UUID.
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

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * For each candidate, call promoteSerial (status + event) when the source
 * state is matrix-valid. Skip already-installed/activated states (metadata
 * was already updated by the bulk UPDATE; no event is appropriate).
 *
 * @param client    An open pg PoolClient — caller owns the transaction.
 * @param candidates  Resolved PP serials with their pre-UPDATE status.
 * @param cutoffTime  Passed through for log context only.
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
 * Encode an integer oes_pp_data.id as a deterministic UUID by zero-padding
 * into the last segment. This gives a stable, non-random UUID that is
 * searchable via `WHERE source_table = 'oes_pp_data' AND source_id = ...`.
 *
 * Example: 42 → '00000000-0000-0000-0000-000000000042'
 */
function ppIdToUuid(ppId: number): string {
  return `00000000-0000-0000-0000-${String(ppId).padStart(12, '0')}`;
}
