/**
 * Stale pre-provision scanner
 *
 * RFC §5.4 — flags pre-provisioned ONTs that have been in the backlog
 * for ≥ N days (default 30) without moving to 'activated'. Usually
 * means the install never happened — operator action required.
 *
 * Emits anomaly_stale_pp against the resolved_drop_number so the event
 * appears on the DR's Timeline and rolls up on the Action Centre
 * Overview.
 *
 * Idempotency: skips emission if an anomaly_stale_pp for the same
 * serial was logged in the last 30 days.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { logAnomalyStalePp } from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('StalePpScanner');

const DEFAULT_STALE_THRESHOLD_DAYS = 30;
const IDEMPOTENCY_WINDOW_DAYS = 30;

export interface StalePpScanSummary {
  staleRowsDetected: number;
  eventsEmitted: number;
  skippedAlreadyEmitted: number;
  skippedNoDrNumber: number;
  errors: string[];
}

interface StaleRow {
  dr_number: string | null;
  serial_number: string;
  project: string | null;
  resolution_status: string | null;
  age_days: number;
}

export async function scanStalePp(
  staleDays: number = DEFAULT_STALE_THRESHOLD_DAYS,
): Promise<StalePpScanSummary> {
  const summary: StalePpScanSummary = {
    staleRowsDetected: 0,
    eventsEmitted: 0,
    skippedAlreadyEmitted: 0,
    skippedNoDrNumber: 0,
    errors: [],
  };

  try {
    const { rows } = await pool.query<StaleRow>(
      `SELECT resolved_drop_number AS dr_number,
              serial_number,
              project,
              resolution_status,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::int AS age_days
         FROM oes_pp_data
        WHERE (resolution_status IS NULL OR resolution_status <> 'activated')
          AND created_at < NOW() - ($1 || ' days')::interval
        ORDER BY created_at ASC`,
      [staleDays],
    );

    summary.staleRowsDetected = rows.length;

    for (const r of rows) {
      // Can't attach a timeline event without a drop number. Count and
      // move on — this is a legitimate gap (PP exists but hasn't been
      // resolved to any DR yet).
      if (!r.dr_number) {
        summary.skippedNoDrNumber++;
        continue;
      }

      try {
        const { rows: existing } = await pool.query<{ id: string }>(
          `SELECT id FROM dr_activity_log
            WHERE drop_number = $1
              AND event_type = 'anomaly_stale_pp'
              AND event_data->>'serial' = $2
              AND created_at > NOW() - ($3 || ' days')::interval
            LIMIT 1`,
          [r.dr_number, r.serial_number, IDEMPOTENCY_WINDOW_DAYS],
        );
        if (existing.length > 0) {
          summary.skippedAlreadyEmitted++;
          continue;
        }

        await logAnomalyStalePp(r.dr_number, {
          serial: r.serial_number,
          ageDays: r.age_days,
          resolutionStatus: r.resolution_status,
          project: r.project,
        });
        summary.eventsEmitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('stale-pp emit failed', {
          dr: r.dr_number,
          serial: r.serial_number,
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
