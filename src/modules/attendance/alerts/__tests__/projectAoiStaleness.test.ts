/**
 * Unit tests for the project-AOI liveness classifier.
 *
 * classifyAoiFreshness takes `nowMs` as an argument rather than reading a
 * clock, so none of this is time-dependent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AOI_ALERT_COOLDOWN_MS,
  AOI_STALE_AFTER_MS,
  buildStalenessMessage,
  claimFreshnessAlert,
  classifyAoiFreshness,
  resetAoiAlertCooldown,
  shouldAlertOnFreshness,
} from '../projectAoiStaleness';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-22T01:15:00.000Z'); // 03:15 SAST

/** A refresh that completed `ageHours` ago. */
function aged(ageHours: number, overrides: { rowCount?: number; unscoredCount?: number } = {}) {
  return classifyAoiFreshness(
    {
      newestComputedAt: new Date(NOW - ageHours * HOUR).toISOString(),
      rowCount: overrides.rowCount ?? 9,
      unscoredCount: overrides.unscoredCount ?? 0,
    },
    NOW,
  );
}

describe('classifyAoiFreshness', () => {
  it('calls a refresh that ran last night current', () => {
    const f = aged(24);
    expect(f.state).toBe('current');
    expect(f.rowCount).toBe(9);
    expect(f.ageMs).toBe(24 * HOUR);
  });

  it('does NOT alert after a single missed run', () => {
    // The refresh is daily at 03:15. One miss puts computed_at at 48h. This is
    // the requirement the threshold was chosen to satisfy — a job that hiccups
    // once must not page anyone, or the channel gets muted before a real
    // stoppage arrives.
    const f = aged(48);
    expect(f.state).toBe('current');
    expect(shouldAlertOnFreshness(f)).toBe(false);
  });

  it('reports a job that has missed two consecutive runs', () => {
    const f = aged(72);
    expect(f.state).toBe('not_running');
    expect(f.detail).toContain('missed at least two consecutive runs');
    expect(shouldAlertOnFreshness(f)).toBe(true);
  });

  it('places the boundary exactly at the threshold', () => {
    const justInside = classifyAoiFreshness(
      { newestComputedAt: new Date(NOW - AOI_STALE_AFTER_MS).toISOString(), rowCount: 9, unscoredCount: 0 },
      NOW,
    );
    expect(justInside.state).toBe('current');
    const justOutside = classifyAoiFreshness(
      { newestComputedAt: new Date(NOW - AOI_STALE_AFTER_MS - 1).toISOString(), rowCount: 9, unscoredCount: 0 },
      NOW,
    );
    expect(justOutside.state).toBe('not_running');
  });

  it('clears 48 hours, so the threshold cannot be tightened past one missed run by accident', () => {
    expect(AOI_STALE_AFTER_MS).toBeGreaterThan(48 * HOUR);
  });

  it('reports an empty table as not running rather than as fresh', () => {
    // MAX() over no rows is null, and a null age must never read as "age 0".
    const f = classifyAoiFreshness({ newestComputedAt: null, rowCount: 0, unscoredCount: 0 }, NOW);
    expect(f.state).toBe('not_running');
    expect(f.ageMs).toBeNull();
    expect(f.detail).toContain('never completed');
  });

  it('separates "ran but skipped rows" from "did not run"', () => {
    const f = aged(24, { unscoredCount: 2 });
    expect(f.state).toBe('rows_unscored');
    expect(f.unscoredCount).toBe(2);
    expect(f.detail).toContain('the job is alive, its distortion scoring is not');
  });

  it('reports a stale job as not running even when rows are also unscored', () => {
    // Unscored rows are downstream of a job that is not running. Reporting the
    // symptom instead of the cause sends someone to debug the wrong function.
    const f = aged(72, { unscoredCount: 5 });
    expect(f.state).toBe('not_running');
  });

  it('stays quiet on a timestamp it cannot read', () => {
    // A formatting bug is not evidence the job stopped.
    const f = classifyAoiFreshness({ newestComputedAt: 'not-a-timestamp', rowCount: 9, unscoredCount: 0 }, NOW);
    expect(f.state).toBe('unknown');
    expect(shouldAlertOnFreshness(f)).toBe(false);
  });
});

describe('shouldAlertOnFreshness', () => {
  it('never alerts on unknown', () => {
    // Migration 523 is not applied everywhere. A probe that cannot see the
    // columns must stay quiet, not page every minute until it can.
    expect(shouldAlertOnFreshness({
      state: 'unknown', newestComputedAt: null, ageMs: null, rowCount: 0, unscoredCount: 0, detail: 'x',
    })).toBe(false);
  });
});

describe('buildStalenessMessage', () => {
  it('points a stopped job at the cron and the log', () => {
    const msg = buildStalenessMessage(aged(72));
    expect(msg).toContain('NOT RUNNING');
    expect(msg).toContain('03:15 cron on fibreflow-dev');
    expect(msg).toContain('project-aoi-refresh.log');
  });

  it('points a skipped-rows fault at the refresh function instead', () => {
    const msg = buildStalenessMessage(aged(24, { unscoredCount: 2 }));
    expect(msg).toContain('ROWS UNSCORED');
    expect(msg).toContain('refresh_project_aois()');
    expect(msg).not.toContain('NOT RUNNING');
  });

  it('says the geofence is still answering off a stale hull', () => {
    // Without this the reader can assume clock-ins stopped being matched. They
    // did not — they are being matched against whatever hull was last written.
    expect(buildStalenessMessage(aged(72))).toContain('still answering clock-ins');
  });
});

describe('claimFreshnessAlert', () => {
  beforeEach(() => resetAoiAlertCooldown());

  it('alerts once and then stays silent for a full day', () => {
    // The host runs every minute. Without this the same stale AOI would send
    // 1,440 messages a day.
    const stale = aged(72);
    expect(claimFreshnessAlert(stale, NOW)).toBe(true);
    expect(claimFreshnessAlert(stale, NOW + 60_000)).toBe(false);
    expect(claimFreshnessAlert(stale, NOW + AOI_ALERT_COOLDOWN_MS - 1)).toBe(false);
    expect(claimFreshnessAlert(stale, NOW + AOI_ALERT_COOLDOWN_MS)).toBe(true);
  });

  it('holds the cooldown at the watched job period, not shorter', () => {
    expect(AOI_ALERT_COOLDOWN_MS).toBe(24 * HOUR);
  });

  it('does not let one state suppress the other', () => {
    // Different causes, different fixes. A `not_running` alert this morning
    // must not swallow a `rows_unscored` alert this afternoon.
    expect(claimFreshnessAlert(aged(72), NOW)).toBe(true);
    expect(claimFreshnessAlert(aged(24, { unscoredCount: 2 }), NOW + 60_000)).toBe(true);
  });

  it('never claims for a state that does not alert', () => {
    expect(claimFreshnessAlert(aged(24), NOW)).toBe(false);
    expect(claimFreshnessAlert({
      state: 'unknown', newestComputedAt: null, ageMs: null, rowCount: 0, unscoredCount: 0, detail: 'x',
    }, NOW)).toBe(false);
  });
});
