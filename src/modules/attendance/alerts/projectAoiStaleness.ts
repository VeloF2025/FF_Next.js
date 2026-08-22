/**
 * Liveness check for the nightly project-AOI refresh, hosted by a cron that is
 * NOT the AOI cron.
 *
 * `project_aois` drives the attendance geofence. Migration 523 catches a hull
 * distorted by a misassigned pole, and `refresh-project-aois.ts` WhatsApps
 * about it — but both of those live inside the refresh. If the refresh stops
 * running altogether, the scoring stops with it and the silence looks exactly
 * like "everything is fine". `project_aois.computed_at` is the only evidence,
 * and until now nothing read it.
 *
 * WHY THIS DOES NOT LIVE IN THE AOI CRON
 * A monitor that runs inside the job it watches cannot report the job's
 * absence. Fleet shipped exactly that shape — a monitor-health check that was
 * itself one of the two jobs it watched — and it structurally could not detect
 * both being absent. So this is called from `/api/cron/db-health`, which runs
 * every minute from a separate crontab line, a separate script and a separate
 * process.
 *
 * THREE STATES, THREE DIFFERENT FIXES
 *   current       — the refresh ran inside its window. Nothing to do.
 *   rows_unscored — the refresh ran but left rows on migration 523's column
 *                   default. The job is alive; its scoring skipped rows.
 *   not_running   — no refresh inside the window, or no AOI rows at all. The
 *                   job is dead: check the crontab on fibreflow-dev and
 *                   /home/velo/logs/project-aoi-refresh.log.
 * Plus `unknown`, which never alerts: migration 523 is not applied everywhere
 * yet, and a probe that cannot see the columns must stay quiet rather than page
 * every minute until it can.
 *
 * EVERYTHING HERE IS BEST-EFFORT. The host is a per-minute production database
 * probe. If this throws, db-health must still report database health and still
 * exit normally — a bug in an attendance data-quality check must never page
 * anyone about the database.
 */

/**
 * The refresh is installed at 03:15 SAST daily (velo crontab, fibreflow-dev).
 * So `computed_at` is at most 24h old in normal operation, and at most 48h old
 * after ONE missed run — which the brief explicitly does not want alerted. The
 * threshold therefore has to clear 48h; 50h adds two hours for run duration and
 * clock skew between the UTC cron host and the SAST schedule.
 *
 * The consequence, stated rather than hidden: a genuinely stopped job is
 * reported on its SECOND consecutive miss, roughly two days in. Tightening this
 * below 48h buys earlier detection at the cost of alerting on every single
 * hiccup, which is how a channel gets muted.
 */
export const AOI_STALE_AFTER_MS = 50 * 60 * 60 * 1000;

/**
 * The host runs every minute. Without a cooldown a stale AOI would alert 1,440
 * times a day and be muted by lunchtime — the same "nobody looks there" failure
 * this whole guard exists to end.
 *
 * 24h, deliberately matched to the watched job's own period rather than to
 * something shorter: nothing about "a daily job has not run" can change faster
 * than daily, so an earlier repeat would carry no new information. At one day
 * apart, each repeat genuinely means "it missed again".
 *
 * The cooldown is per-state, so a `not_running` alert cannot suppress a later
 * `rows_unscored` one — they have different causes and different fixes.
 */
export const AOI_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface AoiFreshnessInput {
  /** ISO timestamp of the newest project_aois.computed_at, or null when the table is empty. */
  newestComputedAt: string | null;
  rowCount: number;
  /** Rows still carrying migration 523's `unassessed` default. Always 0 before 523 lands. */
  unscoredCount: number;
}

export type AoiFreshnessState = 'current' | 'rows_unscored' | 'not_running' | 'unknown';

export interface AoiFreshness {
  state: AoiFreshnessState;
  newestComputedAt: string | null;
  ageMs: number | null;
  rowCount: number;
  unscoredCount: number;
  /** One line naming the cause, safe to put in an alert. */
  detail: string;
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Pure classifier — no clock of its own, so the caller's `nowMs` is the only
 * time source and the tests are not time-dependent.
 *
 * `not_running` outranks `rows_unscored`: if the refresh has not run at all,
 * unscored rows are a consequence of that, not a second independent problem.
 */
export function classifyAoiFreshness(input: AoiFreshnessInput, nowMs: number): AoiFreshness {
  const base = {
    newestComputedAt: input.newestComputedAt,
    rowCount: input.rowCount,
    unscoredCount: input.unscoredCount,
  };

  if (input.rowCount === 0 || input.newestComputedAt === null) {
    return {
      ...base, state: 'not_running', ageMs: null,
      detail: 'no project AOI rows at all — the refresh has never completed, or the table was emptied',
    };
  }

  const parsed = Date.parse(input.newestComputedAt);
  if (!Number.isFinite(parsed)) {
    // Unparseable is not stale — we simply do not know. Alerting here would
    // page on a formatting bug.
    return {
      ...base, state: 'unknown', ageMs: null,
      detail: `could not read computed_at (${input.newestComputedAt})`,
    };
  }

  const ageMs = nowMs - parsed;
  if (ageMs > AOI_STALE_AFTER_MS) {
    return {
      ...base, state: 'not_running', ageMs,
      detail:
        `newest AOI is ${hours(ageMs)} old (threshold ${hours(AOI_STALE_AFTER_MS)}) — ` +
        'the 03:15 refresh has missed at least two consecutive runs',
    };
  }

  if (input.unscoredCount > 0) {
    return {
      ...base, state: 'rows_unscored', ageMs,
      detail:
        `the refresh ran ${hours(ageMs)} ago but left ${input.unscoredCount} of ${input.rowCount} ` +
        'AOI(s) unscored — the job is alive, its distortion scoring is not',
    };
  }

  return {
    ...base, state: 'current', ageMs,
    detail: `${input.rowCount} AOI(s), newest ${hours(ageMs)} old`,
  };
}

/** Only a live, actionable fault alerts. `unknown` never does — see the module docblock. */
export function shouldAlertOnFreshness(freshness: AoiFreshness): boolean {
  return freshness.state === 'not_running' || freshness.state === 'rows_unscored';
}

export function buildStalenessMessage(freshness: AoiFreshness): string {
  const headline =
    freshness.state === 'not_running'
      ? '🚨 *PROJECT AOI REFRESH: NOT RUNNING*'
      : '⚠️ *PROJECT AOI REFRESH: ROWS UNSCORED*';
  const fix =
    freshness.state === 'not_running'
      ? 'Check the 03:15 cron on fibreflow-dev and /home/velo/logs/project-aoi-refresh.log.'
      : 'The refresh is running; its scoring is skipping rows. Check refresh_project_aois().';
  return [
    headline,
    '',
    freshness.detail,
    freshness.newestComputedAt ? `*Newest computed_at:* ${freshness.newestComputedAt}` : null,
    '',
    'The attendance geofence is still answering clock-ins off whatever hull it last had.',
    fix,
    '',
    '_Auto-detected by /api/cron/db-health_',
  ]
    .filter(Boolean)
    .join('\n');
}

// Per-state cooldown. In-memory, so it resets on deploy — the same limitation
// db-health's own DB alert cooldown has, and acceptable for the same reason: a
// duplicate alert after a restart is far cheaper than a missed one.
const lastAlertAt = new Map<AoiFreshnessState, number>();

/** Test seam. Never called in production. */
export function resetAoiAlertCooldown(): void {
  lastAlertAt.clear();
}

/**
 * Returns true when an alert is due now, and records the send. Separate from
 * the sender so the decision is testable without a WhatsApp stub.
 */
export function claimFreshnessAlert(freshness: AoiFreshness, nowMs: number): boolean {
  if (!shouldAlertOnFreshness(freshness)) return false;
  const previous = lastAlertAt.get(freshness.state);
  if (previous !== undefined && nowMs - previous < AOI_ALERT_COOLDOWN_MS) return false;
  lastAlertAt.set(freshness.state, nowMs);
  return true;
}
