/**
 * Maintenance reopen scanner
 *
 * RFC §5.6 — pointer event into the Maintenance tab. Detects cases where
 * a ticket that was marked resolved/closed within the last 30 days has
 * been reopened (status went back to open/assigned/in_progress).
 *
 * Reads ticket_status_changed events from dr_activity_log and emits
 * maintenance_reopened when the pattern holds. Idempotent: skips cases
 * where a maintenance_reopened event already exists for the same
 * ticket within the last 7 days.
 *
 * Can be called from a cron handler or invoked directly for backfill.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { logMaintenanceReopened } from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('MaintenanceReopenScanner');

const RESOLVED_STATUSES = ['resolved', 'closed', 'qa_approved', 'verified'];
const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'pending_qa'];
const REOPEN_WINDOW_DAYS = 30;
const IDEMPOTENCY_WINDOW_DAYS = 7;

export interface ScanSummary {
  eventsScanned: number;
  reopensEmitted: number;
  skippedAlreadyEmitted: number;
  skippedOutsideWindow: number;
  errors: string[];
}

interface StatusChangeRow {
  drop_number: string;
  ticket_id: string;
  ticket_uid: string;
  from_status: string;
  to_status: string;
  created_at: Date;
}

/**
 * Scan recent ticket_status_changed events and emit maintenance_reopened
 * for every resolved→open transition that hasn't been flagged yet.
 */
export async function scanMaintenanceReopens(
  lookbackHours = 24,
): Promise<ScanSummary> {
  const summary: ScanSummary = {
    eventsScanned: 0,
    reopensEmitted: 0,
    skippedAlreadyEmitted: 0,
    skippedOutsideWindow: 0,
    errors: [],
  };

  try {
    // Find status transitions into an open state in the lookback window
    // where from_status was one of the resolved states.
    const { rows } = await pool.query<{
      drop_number: string;
      event_data: { ticketId: string; ticketUid: string; fromStatus: string; toStatus: string };
      created_at: Date;
    }>(
      `SELECT drop_number, event_data, created_at
         FROM dr_activity_log
        WHERE event_type = 'ticket_status_changed'
          AND created_at > NOW() - ($1 || ' hours')::interval
          AND event_data->>'fromStatus' = ANY($2::text[])
          AND event_data->>'toStatus'   = ANY($3::text[])
        ORDER BY created_at DESC`,
      [lookbackHours, RESOLVED_STATUSES, OPEN_STATUSES],
    );

    summary.eventsScanned = rows.length;

    const transitions: StatusChangeRow[] = rows
      .filter((r) => typeof r.event_data?.ticketId === 'string')
      .map((r) => ({
        drop_number: r.drop_number,
        ticket_id: r.event_data.ticketId,
        ticket_uid: r.event_data.ticketUid,
        from_status: r.event_data.fromStatus,
        to_status: r.event_data.toStatus,
        created_at: r.created_at,
      }));

    for (const t of transitions) {
      try {
        // Find the most recent resolved state BEFORE this reopen, to
        // compute daysSinceResolved and confirm the window.
        const { rows: priorRows } = await pool.query<{ created_at: Date }>(
          `SELECT created_at FROM dr_activity_log
            WHERE drop_number = $1
              AND event_type = 'ticket_status_changed'
              AND event_data->>'ticketId' = $2
              AND event_data->>'toStatus' = ANY($3::text[])
              AND created_at < $4
            ORDER BY created_at DESC LIMIT 1`,
          [t.drop_number, t.ticket_id, RESOLVED_STATUSES, t.created_at],
        );
        const priorResolved = priorRows[0];
        if (!priorResolved) {
          summary.skippedOutsideWindow++;
          continue;
        }

        const daysSince = Math.floor(
          (t.created_at.getTime() - priorResolved.created_at.getTime()) / (24 * 3600 * 1000),
        );
        if (daysSince > REOPEN_WINDOW_DAYS) {
          summary.skippedOutsideWindow++;
          continue;
        }

        // Idempotency: skip if we already emitted maintenance_reopened for
        // this ticket recently.
        const { rows: existingRows } = await pool.query<{ id: string }>(
          `SELECT id FROM dr_activity_log
            WHERE drop_number = $1
              AND event_type = 'maintenance_reopened'
              AND event_data->>'ticketId' = $2
              AND created_at > NOW() - ($3 || ' days')::interval
            LIMIT 1`,
          [t.drop_number, t.ticket_id, IDEMPOTENCY_WINDOW_DAYS],
        );
        if (existingRows.length > 0) {
          summary.skippedAlreadyEmitted++;
          continue;
        }

        await logMaintenanceReopened(t.drop_number, {
          ticketId: t.ticket_id,
          ticketUid: t.ticket_uid,
          daysSinceResolved: daysSince,
          previousStatus: t.from_status,
          newStatus: t.to_status,
        });
        summary.reopensEmitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('reopen emit failed', { ticket_id: t.ticket_id, error: msg });
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
