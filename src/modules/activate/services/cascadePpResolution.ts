/**
 * cascadePpResolution
 *
 * Propagate a Pre-Provision resolution into the downstream records that should
 * reflect the install: maintenance_tickets, maintenance_notes, maintenance_activities,
 * drops.ont_serial, and stock_serials.installed_at_drop_number.
 *
 * Idempotent: only touches rows that still need the update.
 *   - tickets only when status is still open/assigned/in_progress
 *   - drops only when ont_serial IS NULL
 *   - stock_serials only when installed_at_drop_number IS NULL
 *
 * Runs in a single transaction. Designed to be called after a bulk resolution
 * step (local-scan / resolve-all / oesPostImport / VLM batch) using a cutoff
 * timestamp captured BEFORE the resolution started.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  promoteCascadeCandidates,
  type CascadeCandidate,
} from './cascadeSerialPromotion';

const logger = createLogger('cascadePpResolution');

export interface CascadePpResolutionResult {
  pp_count: number;
  tickets_resolved: number;
  notes_added: number;
  activities_logged: number;
  drops_backfilled: number;
  stock_serials_updated: number;
}

/**
 * Cascade resolution info downstream for all PPs resolved at or after `cutoffTime`.
 *
 * @param cutoffTime  Capture this BEFORE running the resolution step so we only
 *                    cascade newly-resolved rows.
 */
export async function cascadePpResolution(
  cutoffTime: Date,
): Promise<CascadePpResolutionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const targets = await client.query(
      `
      SELECT pp.id AS pp_id,
             pp.serial_number AS pp_serial,
             pp.project,
             pp.resolved_drop_number AS dr,
             pp.maintenance_ticket_id AS ticket_id,
             pp.resolved_source,
             pp.resolved_details
      FROM oes_pp_data pp
      WHERE pp.resolved_at >= $1
        AND pp.resolution_status IN ('located_local','located_unified','located_oes','located_onemap','located_1map','activated')
        AND pp.resolved_drop_number IS NOT NULL
      `,
      [cutoffTime.toISOString()],
    );

    const result: CascadePpResolutionResult = {
      pp_count: targets.rowCount ?? 0,
      tickets_resolved: 0,
      notes_added: 0,
      activities_logged: 0,
      drops_backfilled: 0,
      stock_serials_updated: 0,
    };

    if (result.pp_count === 0) {
      await client.query('COMMIT');
      return result;
    }

    // ont_serial: only replace if the ticket still shows the original PP serial
    // (the auto-populated value when the PP ticket was created) or is empty.
    // If a human operator manually corrected ont_serial to something else, keep
    // their value — don't silently clobber a verified field correction.
    const ticketUpdate = await client.query(
      `
      UPDATE maintenance_tickets mt
      SET dr_number = pp.resolved_drop_number,
          ont_serial = CASE
            WHEN mt.ont_serial IS NULL OR mt.ont_serial = pp.serial_number
              THEN COALESCE(pp.resolved_details->>'photo_serial', mt.ont_serial)
            ELSE mt.ont_serial
          END,
          status = 'resolved',
          resolved_at = NOW(),
          resolution_path = COALESCE(NULLIF(mt.resolution_path, 'triage_required'), 'investigate_data_gap'),
          updated_at = NOW()
      FROM oes_pp_data pp
      WHERE mt.id = pp.maintenance_ticket_id
        AND pp.resolved_at >= $1
        AND pp.resolved_drop_number IS NOT NULL
        AND mt.status IN ('open','assigned','in_progress')
      RETURNING mt.id
      `,
      [cutoffTime.toISOString()],
    );
    result.tickets_resolved = ticketUpdate.rowCount ?? 0;

    const notesInsert = await client.query(
      `
      INSERT INTO maintenance_notes (id, ticket_id, content, note_type, visibility, is_resolution, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        pp.maintenance_ticket_id,
        format(
          'Auto-resolved via %s (source=%s).' || E'\n' ||
          'DR: %s' || E'\n' ||
          'Matched serial: %s%s' || E'\n' ||
          'Project: %s%s%s' || E'\n' ||
          '[pp=%s]',
          COALESCE(pp.resolved_details->>'method', pp.resolved_source),
          pp.resolved_source,
          pp.resolved_drop_number,
          COALESCE(pp.resolved_details->>'photo_serial', pp.serial_number),
          CASE WHEN pp.resolved_details ? 'edit_distance'
               THEN ' (edit distance ' || (pp.resolved_details->>'edit_distance') || ' from PP serial ' || pp.serial_number || ')'
               ELSE ''
          END,
          pp.project,
          CASE WHEN pp.resolved_details ? 'photo_date' THEN E'\nPhoto submitted: ' || (pp.resolved_details->>'photo_date') ELSE '' END,
          CASE WHEN pp.resolved_details ? 'technician_display_name'
               THEN E'\nTechnician: ' || COALESCE(pp.resolved_details->>'technician_display_name', 'unknown (LID ' || COALESCE(pp.resolved_details->>'technician_lid','?') || ')')
               ELSE ''
          END,
          pp.serial_number
        ),
        'internal', 'private', true, NOW(), NOW()
      FROM oes_pp_data pp
      WHERE pp.resolved_at >= $1
        AND pp.maintenance_ticket_id IS NOT NULL
        AND pp.resolved_drop_number IS NOT NULL
        AND NOT EXISTS (
          -- Dedup is per PP serial, not per ticket: a single ticket can cover
          -- multiple PPs (rare but possible), and each PP gets its own note.
          -- The [pp=<serial>] marker line is the stable anchor.
          SELECT 1 FROM maintenance_notes mn
          WHERE mn.ticket_id = pp.maintenance_ticket_id
            AND mn.is_resolution = true
            AND mn.content LIKE 'Auto-resolved via%'
            AND mn.content LIKE '%[pp=' || pp.serial_number || ']%'
        )
      RETURNING id
      `,
      [cutoffTime.toISOString()],
    );
    result.notes_added = notesInsert.rowCount ?? 0;

    // Activities are append-only audit log. Cutoff filter is the canonical
    // idempotency mechanism (only newly-resolved PPs are touched). Re-resolution
    // (e.g. swap) intentionally produces a fresh activity entry.
    const activitiesInsert = await client.query(
      `
      INSERT INTO maintenance_activities (id, ticket_id, activity_type, description, field_changes, created_by_name, created_by_email, source, created_at)
      SELECT
        gen_random_uuid(),
        pp.maintenance_ticket_id,
        'status_change',
        format(
          'PP auto-resolved (%s). DR=%s, serial=%s%s',
          pp.resolved_source,
          pp.resolved_drop_number,
          COALESCE(pp.resolved_details->>'photo_serial', pp.serial_number),
          CASE WHEN pp.resolved_details ? 'technician_display_name'
               THEN ', technician=' || COALESCE(pp.resolved_details->>'technician_display_name', 'unknown')
               ELSE ''
          END
        ),
        jsonb_build_object(
          'status', jsonb_build_object('from','assigned','to','resolved'),
          'dr_number', jsonb_build_object('from',null,'to',pp.resolved_drop_number),
          'ont_serial', jsonb_build_object('from',pp.serial_number,'to',COALESCE(pp.resolved_details->>'photo_serial', pp.serial_number))
        ),
        'System (PP Cascade)', 'system@fibreflow.app', 'fibreflow', NOW()
      FROM oes_pp_data pp
      WHERE pp.resolved_at >= $1
        AND pp.maintenance_ticket_id IS NOT NULL
        AND pp.resolved_drop_number IS NOT NULL
      RETURNING id
      `,
      [cutoffTime.toISOString()],
    );
    result.activities_logged = activitiesInsert.rowCount ?? 0;

    const dropsUpdate = await client.query(
      `
      UPDATE drops d
      SET ont_serial = COALESCE(pp.resolved_details->>'photo_serial', pp.serial_number),
          updated_at = NOW()
      FROM oes_pp_data pp
      WHERE d.drop_number = pp.resolved_drop_number
        AND d.ont_serial IS NULL
        AND pp.resolved_at >= $1
      RETURNING d.drop_number
      `,
      [cutoffTime.toISOString()],
    );
    result.drops_backfilled = dropsUpdate.rowCount ?? 0;

    // ── Step 2.4.2: Serial lifecycle — two-step write per PR #1805 Pattern B ──
    //
    // STEP A — Metadata bulk UPDATE (no status change).
    //   Runs for ALL eligible serials regardless of current status.
    //   No mig 387 status-validate trigger fires here (status column untouched),
    //   so a single bulk statement is safe even with mixed prior states.
    //   photo_serial wins over pp_serial when both rows exist (ROW_NUMBER).
    //
    // STEP B — Per-row promoteSerial loop.
    //   Only fires for matrix-valid source states:
    //     issued, in_stock, available, allocated_to_project  (mig 387, Track 2.4)
    //   Already-activated / already-installed serials: metadata was set by
    //   Step A; no status event is emitted (PR #1805 regression guard preserved).
    //
    // Order matters: metadata UPDATE first so installed_at_drop_number is set
    // before the trigger fires on the subsequent status change.

    // STEP A: bulk metadata UPDATE — no status column touched.
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
    result.stock_serials_updated = metadataUpdate.rowCount ?? 0;

    // STEP B: per-row promoteSerial for matrix-valid source states.
    //   Build candidate list from the RETURNING rows of Step A.
    const candidates: CascadeCandidate[] = metadataUpdate.rows.map((r) => ({
      serialId:      r.serial_id    as string,
      serialNumber:  r.serial_number as string,
      currentStatus: r.current_status as string,
      ppId:          Number(r.pp_id),
      dropNumber:    r.drop_number  as string,
      photoDate:     r.photo_date   as string | null,
    }));

    const { promoted, metadataOnly } = await promoteCascadeCandidates(
      client,
      candidates,
      cutoffTime,
    );
    logger.info('cascade serial promotion summary', { promoted, metadataOnly });

    await client.query('COMMIT');
    logger.info('PP cascade complete', { ...result });
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PP cascade failed; rolled back', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}
