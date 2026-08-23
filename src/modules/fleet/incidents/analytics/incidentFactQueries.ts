/**
 * The incident-derived half of a month's facts.
 *
 * Everything here comes out of `fleet_operational_incidents` and its satellite
 * tables in ONE pass per month. That is the cheap half; presence is the
 * expensive half and lives in `presenceFactQueries.ts`.
 *
 * Incidents with no operational site are skipped, not defaulted. The aggregate
 * table's dimension pairing has no "unknown site" slot, and inventing one would
 * put a site-less incident into some other site's numbers.
 *
 * Durations are computed in SQL as whole seconds from `opened_at`, and are null
 * when the transition never happened. A null is not a zero: an incident nobody
 * acknowledged has no acknowledgement time, and averaging it in as instant
 * would make the slowest incidents look like the fastest.
 */
import { query } from '@/lib/db-pool';
import type { IncidentFact, NotificationFact } from './facts';

/** How far back a prior incident of the same type still counts as a recurrence. */
export const RECURRENCE_WINDOW_DAYS = 90;

interface IncidentRow extends Record<string, unknown> {
  work_date: string | Date;
  project_id: string;
  operational_site_id: string;
  staff_id: string;
  incident_type: string;
  outcome: string | null;
  acknowledgement_seconds: string | number | null;
  review_start_seconds: string | number | null;
  resolution_seconds: string | number | null;
  driver_response_seconds: string | number | null;
  driver_input_requested: boolean;
  driver_input_responded: boolean;
  driver_input_on_time: boolean;
  evidence_available: boolean;
  is_recurrence: boolean;
}

/**
 * `work_date` is a DATE column, and node-postgres hands DATE back as a local
 * midnight `Date`. Formatting it with `toISOString()` would shift it a day
 * backwards in SAST, so the calendar parts are read directly.
 */
function toWorkDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function toSeconds(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

const INCIDENT_FACT_SQL = `/* fleet-analytics-facts:incidents */
  SELECT
    i.work_date,
    i.project_id,
    i.operational_site_id,
    i.staff_id,
    i.incident_type,
    i.outcome,
    EXTRACT(EPOCH FROM (i.acknowledged_at - i.opened_at))::bigint  AS acknowledgement_seconds,
    EXTRACT(EPOCH FROM (i.review_started_at - i.opened_at))::bigint AS review_start_seconds,
    EXTRACT(EPOCH FROM (i.resolved_at - i.opened_at))::bigint       AS resolution_seconds,
    EXTRACT(EPOCH FROM (sub.first_submitted_at - req.requested_at))::bigint AS driver_response_seconds,
    (req.id IS NOT NULL)                                            AS driver_input_requested,
    (sub.first_submitted_at IS NOT NULL)                            AS driver_input_responded,
    (sub.first_submitted_at IS NOT NULL
      AND req.respond_by IS NOT NULL
      AND sub.first_submitted_at <= req.respond_by)                 AS driver_input_on_time,
    (ev.evidence_count > 0)                                         AS evidence_available,
    (prior.prior_count > 0)                                         AS is_recurrence
  FROM fleet_operational_incidents i
  LEFT JOIN LATERAL (
    SELECT r.id, r.requested_at, r.respond_by
    FROM fleet_incident_driver_input_requests r
    WHERE r.incident_id = i.id AND r.superseded_at IS NULL
    ORDER BY r.requested_at
    LIMIT 1
  ) req ON true
  LEFT JOIN LATERAL (
    SELECT MIN(s.created_at) AS first_submitted_at
    FROM fleet_incident_driver_submissions s
    WHERE s.incident_id = i.id
  ) sub ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS evidence_count
    FROM fleet_operational_incident_evidence e
    WHERE e.incident_id = i.id
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS prior_count
    FROM fleet_operational_incidents p
    WHERE p.staff_id = i.staff_id
      AND p.incident_type = i.incident_type
      AND p.work_date < i.work_date
      AND p.work_date >= i.work_date - ($3::integer)
      AND p.id <> i.id
  ) prior ON true
  WHERE i.work_date >= $1::date
    AND i.work_date < $2::date
    -- Site-less incidents have no dimension to belong to; see the file header.
    AND i.operational_site_id IS NOT NULL
    AND i.project_id IS NOT NULL
  ORDER BY i.work_date, i.id`;

/** Every incident fact for the month starting at `monthStart` (`YYYY-MM-01`). */
export async function loadIncidentFacts(
  monthStart: string,
  nextMonthStart: string,
): Promise<IncidentFact[]> {
  const rows = await query<IncidentRow>(INCIDENT_FACT_SQL, [
    monthStart, nextMonthStart, RECURRENCE_WINDOW_DAYS,
  ]);

  return rows.map((row) => ({
    kind: 'incident' as const,
    workDate: toWorkDate(row.work_date),
    dimension: { projectId: row.project_id, operationalSiteId: row.operational_site_id },
    contributorKey: row.staff_id,
    incidentType: row.incident_type,
    outcome: row.outcome,
    acknowledgementSeconds: toSeconds(row.acknowledgement_seconds),
    reviewStartSeconds: toSeconds(row.review_start_seconds),
    resolutionSeconds: toSeconds(row.resolution_seconds),
    driverResponseSeconds: toSeconds(row.driver_response_seconds),
    driverInputRequested: row.driver_input_requested,
    driverInputResponded: row.driver_input_responded,
    driverInputOnTime: row.driver_input_on_time,
    evidenceAvailable: row.evidence_available,
    isRecurrence: row.is_recurrence,
  }));
}

interface NotificationRow extends Record<string, unknown> {
  work_date: string | Date;
  project_id: string;
  operational_site_id: string;
  staff_id: string;
  delivered: boolean;
}

/**
 * Notifications about an incident, attributed to the driver the incident is
 * ABOUT rather than to the manager who received it.
 *
 * That is the privacy-correct axis as well as the useful one: the aggregate
 * reports on operations at a site, and the recipient's identity is not part of
 * that. `user_notifications.source_id` carries the incident id, which is the
 * only link between the notification bus and this module.
 */
const NOTIFICATION_FACT_SQL = `/* fleet-analytics-facts:notifications */
  SELECT
    i.work_date,
    i.project_id,
    i.operational_site_id,
    i.staff_id,
    COALESCE(d.delivered, false) AS delivered
  FROM user_notifications n
  JOIN fleet_operational_incidents i ON i.id = n.source_id
  LEFT JOIN LATERAL (
    SELECT bool_or(l.status IN ('sent', 'delivered')) AS delivered
    FROM notification_delivery_log l
    WHERE l.notification_id = n.id
  ) d ON true
  WHERE n.source_module = 'fleet-incidents'
    AND i.work_date >= $1::date
    AND i.work_date < $2::date
    AND i.operational_site_id IS NOT NULL
    AND i.project_id IS NOT NULL
  ORDER BY i.work_date, n.id`;

/** Every notification fact for the month, one row per recipient notification. */
export async function loadNotificationFacts(
  monthStart: string,
  nextMonthStart: string,
): Promise<NotificationFact[]> {
  const rows = await query<NotificationRow>(NOTIFICATION_FACT_SQL, [monthStart, nextMonthStart]);
  return rows.map((row) => ({
    kind: 'notification' as const,
    workDate: toWorkDate(row.work_date),
    dimension: { projectId: row.project_id, operationalSiteId: row.operational_site_id },
    contributorKey: row.staff_id,
    delivered: row.delivered,
  }));
}
