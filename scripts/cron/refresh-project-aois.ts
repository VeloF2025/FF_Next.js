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
 * Cron (03:15 SAST daily — after the 02:00 DB backup and the 02:30 selfie
 * retention sweep, before the working day):
 *   15 3 * * * cd /home/velo/fibreflow-production && \
 *     /usr/bin/npx tsx scripts/cron/refresh-project-aois.ts \
 *     >> /var/log/project-aoi-refresh.log 2>&1
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

import { sql } from '../../src/lib/db-pool';
import { log } from '../../src/lib/logger';

interface AoiRow extends Record<string, unknown> {
  project_name: string | null;
  pole_count: number;
  computed_at: string;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const before = await sql.query<AoiRow>(
    `SELECT pr.project_name, a.pole_count, a.computed_at::text
       FROM project_aois a LEFT JOIN projects pr ON pr.id = a.project_id
      ORDER BY pr.project_name`,
    [],
  );
  log.info('[project-aoi-refresh] current state', { aoiCount: before.length });

  if (dryRun) {
    for (const r of before) {
      log.info('[project-aoi-refresh] existing', {
        project: r.project_name, poleCount: r.pole_count, computedAt: r.computed_at,
      });
    }
    log.info('[project-aoi-refresh] dry run — no changes written');
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

  log.info('[project-aoi-refresh] complete', {
    written,
    aoiCount: after.length,
    previousCount: before.length,
  });

  // Zero AOIs is a failure, not an empty success: every subsequent clock-in
  // would silently record no project at all.
  if (after.length === 0) {
    throw new Error('refresh produced zero AOIs — every clock-in would record no project');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[project-aoi-refresh] failed', err instanceof Error ? { message: err.message } : { err });
    process.exit(1);
  });
