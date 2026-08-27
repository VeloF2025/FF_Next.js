/**
 * 08:15 SAST vehicle-incident summary (plan §5, PR8) — one message to the Fleet
 * Alerts WhatsApp group covering YESTERDAY's SAST vehicle incidents, plus the
 * existing per-recipient summary fan-out. Called from `actionRunner.ts`
 * alongside `incidentSummaryPhase.ts`, in its own try/catch: a failure here
 * never blocks the roster summary or escalation, and never touches their totals.
 *
 * Vehicle incidents are the staff-less telematics ones — `staff_id IS NULL` and
 * one of the six source-event types. They carry no project, so they can never
 * be bucketed by project the way the roster summary is; they are one flat
 * summary instead.
 *
 * **The once-per-SAST-day guard is the group post's own claim**, not a monitor
 * run row: `fleet_operational_monitor_runs_kind_check` (migration 510) admits
 * only `status_monitor`/`escalation`/`morning_summary`, and a new run kind
 * would need a migration this PR deliberately does not ship.
 * `postToFleetAlertsGroup` claims `<event>:wa_group` under
 * `fleet-vehicle-morning-summary:<workDate>` and returns without posting when that
 * claim is already held, so exactly one post reaches the group per SAST day. The
 * cost: the counting query and the fan-out re-run on every tick after 08:15 — one
 * indexed aggregate over a single day, and every notification is suppressed by its
 * own idempotency key, so the repetition is cheap and sends nothing twice. There is
 * deliberately no run row; the delivered count is returned to the caller and logged.
 */
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { sastDateString } from '../parking/sastDate';
import { sastMidnightIso, sastMinutesOfDay, shiftSastDate } from './incidentActionShared';
import { postToFleetAlertsGroup } from './incidentGroupDelivery';
import { sendVehicleMorningSummaryNotification, VEHICLE_MORNING_SUMMARY_EVENT } from './incidentNotifications';
import { resolveIncidentRecipients } from './recipientService';
import { INCIDENT_TYPE_LABELS } from './web/incidentLabels';
import type {
  IncidentActionRunnerRequest, IncidentSeverity, IncidentType, VehicleSummaryResult,
} from './types';

const MODULE = 'FleetVehicleSummaryPhase';
const MORNING_SUMMARY_MINUTE_OF_DAY = 8 * 60 + 15; // 08:15 SAST

/** The six telematics/source-event types. Staff-less by construction — a vehicle, not a person, is the subject. */
export const VEHICLE_INCIDENT_TYPES: readonly IncidentType[] = [
  'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement',
  'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving',
];

/**
 * PR4's detectors are not merged yet, so no detector phase reports a live count
 * to fold in here. A line naming what is watched still tells a reader the
 * summary is a running job rather than a stuck one — an all-clear with nothing
 * else on it is indistinguishable from a broken cron.
 *
 * DERIVED from `VEHICLE_INCIDENT_TYPES`, never written out by hand: the first
 * version of this line named four detectors while the query already covered
 * six, so the message quietly under-reported what it was watching. Adding a
 * seventh type now updates the line for free, and `INCIDENT_TYPE_LABELS` is the
 * same wording the incident queue shows, so the two cannot drift apart.
 */
const DETECTOR_LINE = `Vehicle detectors: ${VEHICLE_INCIDENT_TYPES.map((type) => INCIDENT_TYPE_LABELS[type]).join(', ')}`;

export interface VehicleIncidentCount {
  incidentType: IncidentType;
  severity: IncidentSeverity;
  /** Registration snapshot, or `Unrecorded`. The only vehicle identity in the message — no driver, no coordinates, no raw telematics. */
  vehicleRegistration: string;
  count: number;
}

interface CountRow extends Record<string, unknown> {
  incident_type: IncidentType; severity: IncidentSeverity;
  vehicle_registration: string; incident_count: number;
}

async function loadVehicleIncidentCounts(workDate: string): Promise<VehicleIncidentCount[]> {
  const rows = await query<CountRow>(
    `/* fleet-vehicle-summary:yesterday-counts */
     SELECT incident_type, severity,
       COALESCE(NULLIF(btrim(vehicle_registration_snapshot), ''), 'Unrecorded') AS vehicle_registration,
       COUNT(*)::int AS incident_count
     FROM fleet_operational_incidents
     WHERE staff_id IS NULL
       AND incident_type = ANY($1::text[])
       AND detected_at >= $2::timestamptz AND detected_at < $3::timestamptz
     GROUP BY 1, 2, 3
     ORDER BY incident_count DESC, incident_type ASC, vehicle_registration ASC`,
    [[...VEHICLE_INCIDENT_TYPES], sastMidnightIso(workDate), sastMidnightIso(shiftSastDate(workDate, 1))],
  );
  return rows.map((row) => ({
    incidentType: row.incident_type, severity: row.severity,
    vehicleRegistration: row.vehicle_registration, count: Number(row.incident_count),
  }));
}

function fleetIncidentsUrl(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/fleet/incidents`;
}

function totalledBy<K>(rows: readonly VehicleIncidentCount[], keyOf: (row: VehicleIncidentCount) => K): Map<K, number> {
  const totals = new Map<K, number>();
  for (const row of rows) {
    const key = keyOf(row);
    totals.set(key, (totals.get(key) ?? 0) + row.count);
  }
  return totals;
}

/** Type totals for the per-recipient notification payload, which has no severity or vehicle dimension. */
export function vehicleSummaryItems(rows: readonly VehicleIncidentCount[]): { incidentType: IncidentType; count: number }[] {
  return [...totalledBy(rows, (row) => row.incidentType).entries()]
    .map(([incidentType, count]) => ({ incidentType, count }))
    .sort((a, b) => b.count - a.count || a.incidentType.localeCompare(b.incidentType));
}

export function buildVehicleSummaryMessage(workDate: string, rows: readonly VehicleIncidentCount[]): string {
  const header = `🚗 *Vehicle incident summary — ${workDate} (SAST)*`;
  const footer = ['', DETECTOR_LINE, fleetIncidentsUrl()];
  if (rows.length === 0) {
    return [header, `✅ No vehicle incidents recorded for ${workDate}.`, ...footer].join('\n');
  }

  const typeTotals = new Map<string, { incidentType: IncidentType; severity: IncidentSeverity; count: number }>();
  for (const row of rows) {
    const key = `${row.incidentType}|${row.severity}`;
    const seen = typeTotals.get(key);
    if (seen) seen.count += row.count;
    else typeTotals.set(key, { incidentType: row.incidentType, severity: row.severity, count: row.count });
  }
  const byType = [...typeTotals.values()]
    .sort((a, b) => b.count - a.count || a.incidentType.localeCompare(b.incidentType))
    .map((entry) => `• ${entry.incidentType.replaceAll('_', ' ')} (${entry.severity}): ${entry.count}`);
  const byVehicle = [...totalledBy(rows, (row) => row.vehicleRegistration).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([registration, count]) => `• ${registration}: ${count}`);

  return [
    header, `Total: ${rows.reduce((sum, row) => sum + row.count, 0)}`,
    '', 'By type:', ...byType, '', 'By vehicle:', ...byVehicle, ...footer,
  ].join('\n');
}

async function fanOutToRecipients(
  recipientUserIds: readonly string[], workDate: string, rows: readonly VehicleIncidentCount[],
): Promise<{ delivered: number; failed: number }> {
  const items = vehicleSummaryItems(rows);
  const totals = { delivered: 0, failed: 0 };
  for (const recipientUserId of recipientUserIds) {
    // Deliveries, not attempts: this fan-out re-runs on every tick after 08:15 and
    // notify() suppresses an already-reached recipient, so counting attempts would
    // report the summary as freshly sent for the rest of the day.
    const delivery = await sendVehicleMorningSummaryNotification({ recipientUserId, workDate, items });
    totals.delivered += delivery.delivered;
    totals.failed += delivery.failed;
  }
  return totals;
}

/** Null when the tick is before 08:15 SAST — the phase did not run at all, which is not a result. */
export async function runVehicleMorningSummaryPhase(
  request: IncidentActionRunnerRequest,
): Promise<VehicleSummaryResult | null> {
  if (sastMinutesOfDay(request.effectiveAt) < MORNING_SUMMARY_MINUTE_OF_DAY) return null;
  const workDate = shiftSastDate(sastDateString(new Date(request.effectiveAt)), -1);

  const rows = await loadVehicleIncidentCounts(workDate);
  const totalIncidents = rows.reduce((sum, row) => sum + row.count, 0);
  const recipients = await resolveIncidentRecipients(null);
  if (recipients.failed) {
    log.error('[fleet-vehicle-summary] no recipient resolved — vehicle summary not sent', { workDate }, MODULE);
    return { workDate, totalIncidents, groupPostFailed: false, delivered: 0, failed: 1 };
  }

  // The per-recipient fan-out is NOT a fallback here — plan §5 has it run in parallel with the
  // group post, so it is invoked unconditionally below and there is nothing extra to do when
  // the group post fails. `deliverToRecipients` therefore returns 0 rather than double-sending.
  const groupFailures = await postToFleetAlertsGroup({
    incidentId: `vehicle-morning-summary:${workDate}`,
    eventType: VEHICLE_MORNING_SUMMARY_EVENT,
    idempotencyKey: `fleet-vehicle-morning-summary:${workDate}`,
    recipientUserIds: recipients.userIds,
    deliverToRecipients: () => Promise.resolve(0),
  }, buildVehicleSummaryMessage(workDate, rows));

  const fanOut = await fanOutToRecipients(recipients.userIds, workDate, rows);
  const result: VehicleSummaryResult = {
    workDate, totalIncidents, groupPostFailed: groupFailures > 0, delivered: fanOut.delivered,
    failed: fanOut.failed + groupFailures,
  };
  log.info('[fleet-vehicle-summary] vehicle summary tick complete', { ...result }, MODULE);
  return result;
}
