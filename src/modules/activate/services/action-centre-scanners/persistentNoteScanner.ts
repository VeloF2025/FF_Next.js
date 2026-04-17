/**
 * Persistent-note scanner
 *
 * RFC Phase 6 §5.4 — detects DRs that have appeared on the same
 * Fibertime deduction note for ≥ N consecutive weeks and emits an
 * anomaly_persistent_note event so operators see the escalation need.
 *
 * Uses a window function against ft_billing_deductions to group runs of
 * consecutive weeks per (dr_number, deduction_note). A "consecutive"
 * week is defined as exactly 7 days apart from the previous week the
 * DR was flagged on that note — if a DR is flagged in week N but not
 * week N+1 and flagged again in N+2, that's two shorter runs.
 *
 * Idempotency: skips emissions if an anomaly_persistent_note already
 * exists for the same (DR, note, latest_week) in the last 14 days.
 *
 * Can be invoked from a cron handler or directly for backfill.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  logAnomalyPersistentNote,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('PersistentNoteScanner');

const DEFAULT_MIN_CONSECUTIVE_WEEKS = 3;
const IDEMPOTENCY_WINDOW_DAYS = 14;

export interface PersistentScanSummary {
  runsDetected: number;
  eventsEmitted: number;
  skippedAlreadyEmitted: number;
  errors: string[];
}

interface RunRow {
  dr_number: string;
  deduction_note: string;
  first_week: string;
  latest_week: string;
  run_length: number;
}

/**
 * Scan ft_billing_deductions for consecutive-week runs per (DR, note).
 * Emit anomaly_persistent_note when a run reaches the threshold and we
 * haven't emitted it already.
 */
export async function scanPersistentNotes(
  minConsecutiveWeeks: number = DEFAULT_MIN_CONSECUTIVE_WEEKS,
): Promise<PersistentScanSummary> {
  const summary: PersistentScanSummary = {
    runsDetected: 0,
    eventsEmitted: 0,
    skippedAlreadyEmitted: 0,
    errors: [],
  };

  try {
    // Build consecutive-week runs per (DR, note) using a gap-and-islands
    // pattern. We only care about runs whose LATEST week is the current
    // latest billing week — we don't re-flag runs that ended.
    const { rows } = await pool.query<RunRow>(
      `
      WITH latest_week AS (
        SELECT MAX(week_ending) AS w FROM ft_billing_deductions
      ),
      numbered AS (
        SELECT dr_number, deduction_note, week_ending,
               ROW_NUMBER() OVER (PARTITION BY dr_number, deduction_note ORDER BY week_ending) AS rn
          FROM ft_billing_deductions
         WHERE resolution_status <> 'resolved'
           AND resolution_status <> 'auto_closed'
      ),
      runs AS (
        SELECT dr_number, deduction_note, week_ending,
               -- Each "island" shares the same anchor = week - rn*7days.
               week_ending - (rn * INTERVAL '7 days') AS anchor
          FROM numbered
      ),
      aggregated AS (
        SELECT dr_number, deduction_note,
               MIN(week_ending)::text AS first_week,
               MAX(week_ending)::text AS latest_week,
               COUNT(*)::int          AS run_length
          FROM runs
         GROUP BY dr_number, deduction_note, anchor
      )
      SELECT a.dr_number, a.deduction_note, a.first_week, a.latest_week, a.run_length
        FROM aggregated a, latest_week lw
       WHERE a.latest_week::date = lw.w
         AND a.run_length >= $1
       ORDER BY a.run_length DESC, a.dr_number
      `,
      [minConsecutiveWeeks],
    );

    summary.runsDetected = rows.length;

    for (const r of rows) {
      try {
        const { rows: existing } = await pool.query<{ id: string }>(
          `SELECT id FROM dr_activity_log
            WHERE drop_number = $1
              AND event_type = 'anomaly_persistent_note'
              AND event_data->>'noteCode' = $2
              AND event_data->>'latestWeek' = $3
              AND created_at > NOW() - ($4 || ' days')::interval
            LIMIT 1`,
          [r.dr_number, r.deduction_note, r.latest_week, IDEMPOTENCY_WINDOW_DAYS],
        );
        if (existing.length > 0) {
          summary.skippedAlreadyEmitted++;
          continue;
        }

        await logAnomalyPersistentNote(r.dr_number, {
          noteCode: r.deduction_note as NoteCode,
          consecutiveWeeks: r.run_length,
          firstWeek: r.first_week,
          latestWeek: r.latest_week,
        });
        summary.eventsEmitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('persistent-note emit failed', {
          dr: r.dr_number,
          note: r.deduction_note,
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
