#!/usr/bin/env node
/**
 * Project AOI refresh cron.
 *
 * Rebuilds `project_aois` — the convex hull of each project's surveyed poles
 * — by calling `refresh_project_aois()` (migration 499). Clock-in records the
 * nearest AOI at write time, so a stalled refresh means new sites go
 * unrecognised and workers on them read as "far" forever.
 *
 * Usage:
 *   npx tsx scripts/cron/refresh-project-aois.ts
 *   npx tsx scripts/cron/refresh-project-aois.ts --dry-run
 *
 * Installed in the velo crontab, 03:15 SAST daily — after the 02:00 DB
 * backup, the 02:30 selfie retention sweep and the 02:45/03:00 attendance
 * reconciles:
 *
 *   15 3 * * * cd /home/velo/fibreflow-dev && \
 *     ./node_modules/.bin/tsx scripts/cron/refresh-project-aois.ts \
 *     >> /home/velo/logs/project-aoi-refresh.log 2>&1
 *
 * fibreflow-DEV, not production, matching every sibling attendance cron
 * (reconcile, cartrack-reconcile). dev and production share one database, so
 * the directory only decides whose checkout supplies the code — and dev
 * tracks master while production can sit commits behind.
 *
 * If this header and the installed crontab ever disagree, trust the crontab
 * and fix the header. Repointing the job to match a stale header can land it
 * on a checkout missing this file's dotenv loading, where it dies nightly on
 * "SASL: client password must be a string" — and the only symptom is the
 * check-in locations report warning about stale geometry days later.
 *
 * Notes:
 *   - Pole data changes slowly (survey imports), so daily is ample. This is
 *     not on any user-facing path; the clock-in reads the table, never this.
 *   - Exits non-zero on failure so cron alerting picks it up. It also exits
 *     non-zero if the refresh produces ZERO AOIs, because that is
 *     indistinguishable from a silent success and would leave every clock-in
 *     unmatched. See `feedback_guard_false_negative_direction` — bias to
 *     shouting.
 *   - Since migration 523 the refresh also scores each hull for outlier
 *     distortion. This script reads that score back and WhatsApps the ops group
 *     when a project NEWLY becomes distorted. Only a transition alerts, and only
 *     `distorted` does — a nightly message about a condition nobody has fixed
 *     yet is how a channel gets muted, which is the same silence that let one
 *     pole 145 km out of its site inflate a geofence 63x for months. The alert
 *     is best-effort and NEVER changes the exit code: the refresh itself has
 *     already succeeded by then.
 */

import * as dotenv from 'dotenv';

// Cron entry points write to stderr, matching the sibling attendance crons.
//
// Precisely why, because the shorthand in those files ("the logger is a
// no-op") is not quite right: @/lib/logger sends warn/error to stderr
// always, but info/debug ONLY when LOG_STDOUT=true (src/lib/logger.ts:152).
// Cron does not set it, so every progress line — how many AOIs were found,
// how many were written — would vanish, and the log would contain nothing
// but silence on a good night and a bare error on a bad one. This script's
// whole value under cron is its progress output. console.* is disallowed by
// lint (#2007), so stderr it is.
function stderr(msg: string): void {
  process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
}

// Environment: .env.production in prod, .env.local for dev runs. tsx does NOT
// load these on its own — without this the pg client gets an undefined
// password and dies with "SASL: client password must be a string".
dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  stderr('[project-aoi-refresh] DATABASE_URL not set — aborting refresh');
  process.exit(2);
}

interface AoiRow extends Record<string, unknown> {
  project_name: string | null;
  pole_count: number;
  computed_at: string;
}

/** Migration 523's distortion scoring, read back after the refresh. */
interface AoiHealthRow extends Record<string, unknown> {
  project_name: string | null;
  aoi_status: string;
  pole_count: number;
  outlier_pole_count: number;
  aoi_area_m2: string | null;
  robust_aoi_area_m2: string | null;
  aoi_area_ratio: string | null;
  furthest_outlier_m: string | null;
  aoi_status_reason: string | null;
  previous_aoi_status: string | null;
  previous_aoi_area_m2: string | null;
  aoi_growth_ratio: string | null;
}

// Defaults match the convention in the sibling attendance cron
// (attendance-cartrack-reconcile.ts) so an unconfigured install still routes
// somewhere visible rather than nowhere.
const DEFAULT_OPS_WA_GROUP_JID = '120363421664266245@g.us';

/** numeric columns arrive as strings from pg; null stays null. */
function num(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Best-effort. A send failure MUST NOT change the exit code — the refresh has
 * already succeeded, and a red cron job over an undelivered message trains
 * people to ignore the job.
 */
async function alertOnDistortedAois(): Promise<void> {
  try {
    const { sql } = await import('../../src/lib/db-pool');
    const rows = await sql.query<AoiHealthRow>(
      `SELECT pr.project_name, a.aoi_status, a.pole_count, a.outlier_pole_count,
              a.aoi_area_m2::text, a.robust_aoi_area_m2::text,
              a.aoi_area_ratio::text, a.furthest_outlier_m::text,
              a.aoi_status_reason, a.previous_aoi_status,
              a.previous_aoi_area_m2::text, a.aoi_growth_ratio::text
         FROM project_aois a LEFT JOIN projects pr ON pr.id = a.project_id
        ORDER BY a.aoi_status, pr.project_name`,
      [],
    );
    const { sendProjectAoiDistortionAlert } = await import(
      '../../src/modules/attendance/alerts/projectAoiAlert'
    );
    const { sendWhatsAppGroup } = await import(
      '../../src/modules/notifications/services/whatsappDelivery'
    );
    const groupJid =
      process.env.ATTENDANCE_OPS_WA_GROUP_JID ||
      process.env.WA_INFRA_GROUP_JID ||
      DEFAULT_OPS_WA_GROUP_JID;
    if (groupJid === DEFAULT_OPS_WA_GROUP_JID) {
      stderr(
        '[project-aoi-refresh] no ATTENDANCE_OPS_WA_GROUP_JID / WA_INFRA_GROUP_JID set — routing the alert to the default ops group',
      );
    }
    await sendProjectAoiDistortionAlert({
      rows: rows.map((r) => ({
        projectName: r.project_name,
        aoiStatus: r.aoi_status,
        aoiStatusReason: r.aoi_status_reason,
        previousAoiStatus: r.previous_aoi_status,
        poleCount: Number(r.pole_count),
        outlierPoleCount: Number(r.outlier_pole_count),
        aoiAreaM2: num(r.aoi_area_m2),
        robustAoiAreaM2: num(r.robust_aoi_area_m2),
        aoiAreaRatio: num(r.aoi_area_ratio),
        furthestOutlierM: num(r.furthest_outlier_m),
        previousAoiAreaM2: num(r.previous_aoi_area_m2),
        aoiGrowthRatio: num(r.aoi_growth_ratio),
      })),
      groupJid,
      send: sendWhatsAppGroup,
      logger: { info: (msg) => stderr(msg), error: (msg) => stderr(msg) },
    });
  } catch (alertErr) {
    stderr(
      `[project-aoi-refresh] AOI distortion alerter crashed (non-fatal): ${
        alertErr instanceof Error ? alertErr.message : String(alertErr)
      }`,
    );
  }
}

async function main(): Promise<void> {
  // Imported here, not at the top: db-pool reads DATABASE_URL when the module
  // first loads, and a static import would be hoisted above dotenv.config().
  // A top-level await is not an option — tsx emits CJS, which rejects it.
  const { sql } = await import('../../src/lib/db-pool');

  const dryRun = process.argv.includes('--dry-run');

  const before = await sql.query<AoiRow>(
    `SELECT pr.project_name, a.pole_count, a.computed_at::text
       FROM project_aois a LEFT JOIN projects pr ON pr.id = a.project_id
      ORDER BY pr.project_name`,
    [],
  );
  stderr(`[project-aoi-refresh] current state: ${before.length} AOI(s)`);

  if (dryRun) {
    for (const r of before) {
      stderr(`[project-aoi-refresh] existing: ${r.project_name} poles=${r.pole_count} computedAt=${r.computed_at}`);
    }
    stderr('[project-aoi-refresh] dry run — no changes written');
    return;
  }

  const result = await sql.query<{ refresh_project_aois: number }>(
    'SELECT refresh_project_aois()',
    [],
  );
  const written = Number(result[0]?.refresh_project_aois ?? 0);

  const after = await sql.query<AoiRow>(
    `SELECT pr.project_name, a.pole_count, a.computed_at::text
       FROM project_aois a LEFT JOIN projects pr ON pr.id = a.project_id
      ORDER BY pr.project_name`,
    [],
  );

  stderr(`[project-aoi-refresh] complete: written=${written} aois=${after.length} previous=${before.length}`);

  // Zero AOIs is a failure, not an empty success: every subsequent clock-in
  // would silently record no project at all.
  if (after.length === 0) {
    throw new Error('refresh produced zero AOIs — every clock-in would record no project');
  }

  // After the zero-AOI guard on purpose: with no AOIs at all there is nothing
  // to score, and the thrown error above is the louder signal.
  await alertOnDistortedAois();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    stderr(`[project-aoi-refresh] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
