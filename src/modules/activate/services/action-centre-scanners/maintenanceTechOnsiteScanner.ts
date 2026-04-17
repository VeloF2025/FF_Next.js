/**
 * Maintenance "tech on site" scanner
 *
 * RFC §5.6 — pointer event into the Maintenance tab. Detects when the
 * first maintenance_wa_photo arrives for a DR after a maintenance
 * ticket was opened for it, then emits maintenance_tech_onsite with
 * the photo count at the moment of detection.
 *
 * Pairs with the rest of the maintenance lifecycle (ticket_created →
 * tech_onsite → resolved → reopened) to give the Timeline a complete
 * pointer view into work that's actually happening on the field side.
 *
 * Idempotency: skip emissions where maintenance_tech_onsite has
 * already been logged for the same ticket within the last 30 days.
 *
 * Called from the weekly recon cron. Also invokable directly for
 * backfill.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { logMaintenanceTechOnsite } from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('MaintenanceTechOnsiteScanner');

const IDEMPOTENCY_WINDOW_DAYS = 30;

export interface TechOnsiteScanSummary {
  openTicketsScanned: number;
  eventsEmitted: number;
  skippedAlreadyEmitted: number;
  skippedNoPhotos: number;
  errors: string[];
}

interface Candidate {
  dr_number: string;
  ticket_id: string;
  ticket_uid: string;
  ticket_created_at: Date;
  photo_count: number;
  first_photo_at: Date;
}

export async function scanMaintenanceTechOnsite(
  lookbackDays = 14,
): Promise<TechOnsiteScanSummary> {
  const summary: TechOnsiteScanSummary = {
    openTicketsScanned: 0,
    eventsEmitted: 0,
    skippedAlreadyEmitted: 0,
    skippedNoPhotos: 0,
    errors: [],
  };

  try {
    // Find open-ish maintenance tickets with at least one maintenance
    // photo submitted for that DR after the ticket was created.
    const { rows } = await pool.query<Candidate>(
      `
      WITH candidates AS (
        SELECT t.id          AS ticket_id,
               t.ticket_uid,
               t.dr_number,
               t.created_at  AS ticket_created_at
          FROM maintenance_tickets t
         WHERE t.dr_number IS NOT NULL
           AND t.ticket_type = 'maintenance'
           AND t.status NOT IN ('closed', 'cancelled')
           AND t.created_at > NOW() - ($1 || ' days')::interval
      ),
      photos AS (
        SELECT c.ticket_id, c.ticket_uid, c.dr_number, c.ticket_created_at,
               COUNT(p.id)::int AS photo_count,
               MIN(p.created_at) AS first_photo_at
          FROM candidates c
          JOIN maintenance_wa_photos p
            ON p.drop_number = c.dr_number
           AND p.created_at >= c.ticket_created_at
         GROUP BY c.ticket_id, c.ticket_uid, c.dr_number, c.ticket_created_at
      )
      SELECT * FROM photos ORDER BY first_photo_at DESC
      `,
      [lookbackDays],
    );

    summary.openTicketsScanned = rows.length;

    for (const r of rows) {
      try {
        // Skip if we already emitted maintenance_tech_onsite for this
        // ticket recently.
        const { rows: existing } = await pool.query<{ id: string }>(
          `SELECT id FROM dr_activity_log
            WHERE drop_number = $1
              AND event_type = 'maintenance_tech_onsite'
              AND event_data->>'ticketId' = $2
              AND created_at > NOW() - ($3 || ' days')::interval
            LIMIT 1`,
          [r.dr_number, r.ticket_id, IDEMPOTENCY_WINDOW_DAYS],
        );
        if (existing.length > 0) {
          summary.skippedAlreadyEmitted++;
          continue;
        }

        await logMaintenanceTechOnsite(r.dr_number, {
          ticketId: r.ticket_id,
          ticketUid: r.ticket_uid,
          photoCount: r.photo_count,
          firstPhotoAt: r.first_photo_at.toISOString(),
        });
        summary.eventsEmitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('tech_onsite emit failed', {
          ticket_id: r.ticket_id,
          dr: r.dr_number,
          error: msg,
        });
        summary.errors.push(msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('scanner failed', { error: msg });
    summary.errors.push(msg);
  }

  return summary;
}
