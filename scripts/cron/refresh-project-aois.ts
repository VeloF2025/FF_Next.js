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
 * which dir it runs from only decides whose checkout supplies the code — and
 * dev tracks master, while production can sit commits behind. An earlier
 * draft of this header said production; the crontab said dev. Anyone who
 * "corrected" the crontab to match would have pointed it at a checkout
 * without this file's dotenv fix, and it would have died nightly on
 * "SASL: client password must be a string". Keep the two in step.
 *
 * Notes:
 *   - Pole data changes slowly (survey imports), so daily is ample. This is
 *     not on any user-facing path; the clock-in reads the table, never this.
 *   - Exits non-zero on failure so cron alerting picks it up. It also exits
 *     non-zero if the refresh produces ZERO AOIs, because that is
 *     indistinguishable from a silent success and would leave every clock-in
 *     unmatched. See `feedback_guard_false_negative_direction` — bias to
 *     shouting.
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
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    stderr(`[project-aoi-refresh] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
