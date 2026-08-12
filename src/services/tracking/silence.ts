/**
 * Trackers that have gone dark, detected by anchoring on check-ins.
 *
 * A check-in is independent evidence that a human was physically at the vehicle
 * at a known time. If the tracker said nothing anywhere near that moment, the
 * tracker is the thing at fault — not the vehicle being parked.
 *
 * Two detectors were rejected first, and both failed for reasons worth keeping:
 *
 *  - A fixed "no fix in N hours" threshold fires on every vehicle parked
 *    overnight. LL92LYGP legitimately goes 15 hours quiet.
 *  - Comparing fix COUNTS between vehicles measures how much each one drove.
 *    Over 7 days HW50KNGP logged 4 fixes to a sibling's 32 — but it also drove
 *    167km to that sibling's 926km. Normalised, it was within ~1.5x. The raw
 *    ratio looked like a smoking gun and was not one.
 *
 * Odometer readings are deliberately NOT an input: one vehicle reported a
 * 909,312 km delta in a single week, so magnitude cannot be trusted without
 * outlier rejection. Only the check-in's EXISTENCE and TIME are used.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { raiseTrackingAlert } from './alerts';
import type { ProviderKey } from './types';

export interface CheckInAnchor {
  vehicleId: string;
  registration: string;
  checkInAt: Date;
  /** Distance in ms to the nearest fix, or null when there is no fix at all. */
  nearestFixMs: number | null;
}

export interface SilentTracker {
  vehicleId: string;
  registration: string;
  checkInAt: Date;
}

export function findSilentTrackers(
  rows: CheckInAnchor[],
  windowMs: number
): SilentTracker[] {
  return rows
    .filter((r) => r.nearestFixMs !== null && r.nearestFixMs > windowMs)
    .map(({ vehicleId, registration, checkInAt }) => ({ vehicleId, registration, checkInAt }));
}

/**
 * Calibrated against 30 days of production check-ins, restricted to check-ins
 * AFTER each tracker's own mapping date (see the query below for why that
 * restriction is load-bearing). Per-feed nearest-fix-to-check-in: velocity
 * p50 0.00h/max 0.02h; urent p50 0.17h/max 0.83h; avis p50 0.63h/max 1.55h;
 * europcar p50 1.00h/p90 3.53h/max 6.24h (LG88LJGP). Zero check-ins had no fix
 * at all. 12h is ~1.9x the worst healthy observation, with headroom that only
 * grows as poll cadence tightens (Task 5).
 *
 * At calibration time the detector had ZERO positives — nothing in production
 * would be flagged, including HW50KNGP (sparse but not dead once normalised
 * for the distance it actually drove; see the header). This ships unproven
 * against a true positive; silence.test.ts synthesises one.
 */
export const SILENCE_WINDOW_MS = 12 * 60 * 60 * 1000;

type SilenceRow = {
  vehicle_id: string;
  registration: string;
  created_at: Date;
  nearest_fix_ms: number | null;
  provider: ProviderKey;
  account_ref: string;
  last_gap_alert_at: Date | null;
};

export interface SilenceCheckResult {
  /** Check-ins that had an active tracker to assess. */
  checked: number;
  /** Vehicles found silent this tick. */
  silent: number;
}

/**
 * Query, detect, and alert — once per tick. Deliberately not part of
 * pollProvider: that runs once PER PROVIDER, and this assesses the whole
 * fleet, so calling it there would evaluate every vehicle twice per tick.
 *
 * `last_gap_alert_at` is read from the SAME (provider, account_ref) row the
 * account-wide gap detector (pollProvider.ts) uses. There is no per-vehicle
 * dedup store — adding one is a schema change out of scope here — so silent
 * vehicles on one account are grouped into a single alert call and share that
 * account's 24h re-alert cooldown with each other AND with an unrelated
 * account-wide gap. That is a real coarseness, not a bug: both conditions mean
 * "this account's tracking data cannot be trusted right now", and reusing the
 * existing wall-clock (Task 2) is what keeps a dead tracker from paging
 * someone every tick once cadence ramps to 10 minutes.
 */
export async function runSilenceCheck(now: Date): Promise<SilenceCheckResult> {
  // Validated against production (read-only) by the controller. The second
  // WHERE clause is load-bearing: without `c.created_at > t.created_at`, a
  // check-in that predates its tracker's mapping has no positions to match
  // against, reports as days-stale, and fires a false alert on day one — that
  // is exactly what the first calibration pass hit before this was added.
  const rows = await sql<SilenceRow>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      c.created_at,
      min(abs(extract(epoch FROM (p.recorded_at - c.created_at)))) * 1000 AS nearest_fix_ms,
      t.provider,
      t.account_ref,
      w.last_gap_alert_at
    FROM fleet_check_records c
    JOIN fleet_vehicles v ON v.id = c.vehicle_id AND v.status = 'active'
    JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN fleet_vehicle_positions p ON p.vehicle_id = v.id
    LEFT JOIN fleet_tracking_watermarks w ON w.provider = t.provider AND w.account_ref = t.account_ref
    WHERE c.created_at > now() - interval '3 days'
      AND c.created_at > t.created_at
    GROUP BY v.id, v.registration, c.created_at, t.provider, t.account_ref, w.last_gap_alert_at
  `;

  const anchors: CheckInAnchor[] = rows.map((r) => ({
    vehicleId: r.vehicle_id,
    registration: r.registration,
    checkInAt: new Date(r.created_at),
    nearestFixMs: r.nearest_fix_ms === null ? null : Number(r.nearest_fix_ms),
  }));
  const byVehicle = new Map(rows.map((r) => [r.vehicle_id, r]));

  const silent = findSilentTrackers(anchors, SILENCE_WINDOW_MS);
  if (silent.length === 0) {
    return { checked: anchors.length, silent: 0 };
  }

  interface Group { provider: ProviderKey; accountRef: string; lastGapAlertAt: Date | null; trackers: SilentTracker[] }
  const groups = new Map<string, Group>();
  for (const s of silent) {
    const meta = byVehicle.get(s.vehicleId);
    if (!meta) continue; // unreachable: s was derived from these same rows
    const key = `${meta.provider}::${meta.account_ref}`;
    const group = groups.get(key)
      ?? { provider: meta.provider, accountRef: meta.account_ref, lastGapAlertAt: meta.last_gap_alert_at, trackers: [] };
    group.trackers.push(s);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const detail = group.trackers
      .map((t) => `${t.registration} checked in ${t.checkInAt.toISOString()} with no tracker fix nearby`)
      .join('; ');
    const { decision, delivered } = await raiseTrackingAlert({
      kind: 'gap',
      // No per-vehicle tick streak exists to report (see the module header);
      // decideAlert never reads this for kind 'gap', it only reaches notify()
      // metadata, so 0 is the honest value rather than an invented one.
      consecutiveFailures: 0,
      nowSast: now,
      lastGapAlertAt: group.lastGapAlertAt,
      provider: group.provider,
      accountRef: group.accountRef,
      detail,
    });
    // Same delivered-gate as pollProvider.ts's account-wide gap: a truthy
    // decision only means the POLICY said to alert, not that anyone heard it.
    if (delivered && decision?.stampGapAlert) {
      await sql`
        UPDATE fleet_tracking_watermarks SET last_gap_alert_at = now()
        WHERE provider = ${group.provider} AND account_ref = ${group.accountRef}
      `;
    }
  }

  log.warn('[poll-portal-tracking] silence check: trackers gone dark', {
    checked: anchors.length, silent: silent.length, accounts: groups.size,
    registrations: silent.map((s) => s.registration),
  });
  return { checked: anchors.length, silent: silent.length };
}
