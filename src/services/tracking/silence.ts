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
  /** This vehicle's own re-alert cooldown — see fleet_tracker_silence_alerts (migration 492). */
  last_alert_at: Date | null;
};

/**
 * The timestamp to hand `decideAlert` for a GROUP of silent vehicles, given
 * each one's own cooldown.
 *
 * `decideAlert` only knows how to ask "is ONE timestamp past 24h old (or
 * null)". A group alert must fire the moment ANY member is due — a vehicle
 * that has never alerted (null) is the most overdue state there is, so a
 * single null anywhere in the group makes the whole group null (always due).
 * Otherwise the OLDEST timestamp in the group determines it, because that is
 * the member closest to (or past) its 24h mark.
 */
export function earliestCooldownAnchor(dates: Array<Date | null>): Date | null {
  if (dates.length === 0 || dates.some((d) => d === null)) return null;
  return (dates as Date[]).reduce((oldest, d) => (d < oldest ? d : oldest));
}

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
 * Cooldown is per VEHICLE (fleet_tracker_silence_alerts, migration 492), not
 * per account. An earlier version reused fleet_tracking_watermarks'
 * account-level last_gap_alert_at, which review correctly rejected: with 3-7
 * vehicles per account, a second vehicle going silent within 24h of the first
 * got no alert of its own — a real defect, not acceptable coarseness. See the
 * migration header for why a dedicated table, not a synthetic account_ref
 * (VARCHAR(50) is too short) or a widened watermarks row (would pollute every
 * operational query against real provider/account pairs).
 *
 * The alert stays grouped per account — `detail` still names every currently
 * silent vehicle in one notification — but now fires whenever ANY member of
 * the group is past ITS OWN cooldown (earliestCooldownAnchor), and on
 * delivery stamps last_alert_at for EVERY vehicle named, not just the one
 * that triggered it. That is what makes a newly-silent vehicle always alert
 * immediately, even mid-cooldown for an account-mate that alerted earlier.
 */
export async function runSilenceCheck(now: Date): Promise<SilenceCheckResult> {
  // Validated against production (read-only) by the controller. The second
  // WHERE clause is load-bearing: without `c.created_at > t.created_at`, a
  // check-in that predates its tracker's mapping has no positions to match
  // against, reports as days-stale, and fires a false alert on day one — that
  // is exactly what the first calibration pass hit before this was added.
  //
  // The third clause closes a real-time race, seen in production 2026-08-13:
  // LL92LYGP checked in at 07:05:35; the detector ran at 07:10, five minutes
  // later, and the nearest fix on record was still the PREVIOUS evening's —
  // 13.1h away, past the 12h window — so it was flagged. The tracker actually
  // reported 24 minutes after check-in (true gap 0.40h). The vehicle was
  // never silent; the detector just asked before a healthy tracker had any
  // chance to answer. Left unfixed this fires most mornings for most of the
  // fleet — park overnight, check in at 07:00, tracker reports minutes later
  // — which is exactly the alert-fatigue failure this detector exists to
  // remove. A check-in is therefore only evaluated once a FULL window has
  // elapsed since it, so the answer is determinate rather than a race. This
  // looks like a pointless restriction in isolation; it is not — do not
  // remove it. Must equal SILENCE_WINDOW_MS, never a second hardcoded
  // literal, or the two will silently drift apart.
  const rows = await sql<SilenceRow>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      c.created_at,
      min(abs(extract(epoch FROM (p.recorded_at - c.created_at)))) * 1000 AS nearest_fix_ms,
      t.provider,
      t.account_ref,
      sa.last_alert_at
    FROM fleet_check_records c
    JOIN fleet_vehicles v ON v.id = c.vehicle_id AND v.status = 'active'
    JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN fleet_vehicle_positions p ON p.vehicle_id = v.id
    LEFT JOIN fleet_tracker_silence_alerts sa ON sa.vehicle_id = v.id
    WHERE c.created_at > now() - interval '3 days'
      AND c.created_at > t.created_at
      AND c.created_at < now() - (${SILENCE_WINDOW_MS} || ' milliseconds')::interval
    GROUP BY v.id, v.registration, c.created_at, t.provider, t.account_ref, sa.last_alert_at
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

  interface Group { provider: ProviderKey; accountRef: string; trackers: SilentTracker[] }
  const groups = new Map<string, Group>();
  for (const s of silent) {
    const meta = byVehicle.get(s.vehicleId);
    if (!meta) continue; // unreachable: s was derived from these same rows
    const key = `${meta.provider}::${meta.account_ref}`;
    const group = groups.get(key)
      ?? { provider: meta.provider, accountRef: meta.account_ref, trackers: [] };
    group.trackers.push(s);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const detail = group.trackers
      .map((t) => `${t.registration} checked in ${t.checkInAt.toISOString()} with no tracker fix nearby`)
      .join('; ');
    const cooldownAnchor = earliestCooldownAnchor(
      group.trackers.map((t) => byVehicle.get(t.vehicleId)?.last_alert_at ?? null)
    );
    const { decision, delivered } = await raiseTrackingAlert({
      kind: 'gap',
      // No per-vehicle tick streak exists to report (see the module header);
      // decideAlert never reads this for kind 'gap', it only reaches notify()
      // metadata, so 0 is the honest value rather than an invented one.
      consecutiveFailures: 0,
      nowSast: now,
      lastGapAlertAt: cooldownAnchor,
      provider: group.provider,
      accountRef: group.accountRef,
      detail,
    });
    // Same delivered-gate as the account-wide gap path: a truthy decision
    // only means the POLICY said to alert, not that anyone heard it. An
    // undelivered alert must not start a 24h silence on any vehicle named
    // in it — the next tick has to be free to try again.
    if (delivered && decision?.stampGapAlert) {
      for (const tracker of group.trackers) {
        await sql`
          INSERT INTO fleet_tracker_silence_alerts (vehicle_id, last_alert_at, updated_at)
          VALUES (${tracker.vehicleId}, now(), now())
          ON CONFLICT (vehicle_id) DO UPDATE SET last_alert_at = now(), updated_at = now()
        `;
      }
    }
  }

  log.warn('[poll-portal-tracking] silence check: trackers gone dark', {
    checked: anchors.length, silent: silent.length, accounts: groups.size,
    registrations: silent.map((s) => s.registration),
  });
  return { checked: anchors.length, silent: silent.length };
}
