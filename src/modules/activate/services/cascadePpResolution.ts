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

    const ticketUpdate = await client.query(
      `
      UPDATE maintenance_tickets mt
      SET dr_number = pp.resolved_drop_number,
          ont_serial = COALESCE(pp.resolved_details->>'photo_serial', mt.ont_serial),
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
          'Project: %s%s%s',
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
          END
        ),
        'internal', 'private', true, NOW(), NOW()
      FROM oes_pp_data pp
      WHERE pp.resolved_at >= $1
        AND pp.maintenance_ticket_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_notes mn
          WHERE mn.ticket_id = pp.maintenance_ticket_id
            AND mn.is_resolution = true
            AND mn.content LIKE 'Auto-resolved via%'
        )
      RETURNING id
      `,
      [cutoffTime.toISOString()],
    );
    result.notes_added = notesInsert.rowCount ?? 0;

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
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_activities ma
          WHERE ma.ticket_id = pp.maintenance_ticket_id
            AND ma.created_by_name = 'System (PP Cascade)'
        )
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

    const stockUpdate = await client.query(
      `
      UPDATE stock_serials ss
      SET installed_at_drop_number = pp.resolved_drop_number,
          installed_date = COALESCE((pp.resolved_details->>'photo_date')::date, CURRENT_DATE),
          status = 'installed',
          updated_at = NOW()
      FROM oes_pp_data pp
      WHERE ss.serial_number = pp.serial_number
        AND ss.installed_at_drop_number IS NULL
        AND pp.resolved_at >= $1
      RETURNING ss.serial_number
      `,
      [cutoffTime.toISOString()],
    );
    result.stock_serials_updated = stockUpdate.rowCount ?? 0;

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
