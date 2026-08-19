/**
 * GET /api/my/hub-summary
 *
 * Aggregator for the /my hub tile grid. Returns the badge data the hub
 * needs to render in one round-trip instead of N. Session-gated; staff
 * sees only their own counts.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import {
  findOpenEntry,
  findActiveVehicleAssignment,
  sastWorkDate,
} from '@/modules/attendance/portal/clockUtils';
import { countOwnAdjustmentsByStatus } from '@/modules/attendance/corrections/queries';
import { findLatestPayslipForStaff } from '@/modules/payslips/queries';
import { findLatestReceiptForStaff } from '@/modules/receipts/queries';
import {
  findRequiredAttendanceAction,
  type RequiredAttendanceAction,
} from '@/modules/attendance/workflow/requiredActionQueries';
import { listDriverIncidents } from '@/modules/fleet/incidents/driver/driverIncidentService';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export interface HubSummary {
  openEntry: {
    id: string;
    clockInAt: string;
    durationMs: number;
  } | null;
  assignedVehicle: {
    id: string;
    vehicleId: string | null;
    registration: string | null;
    checkStatusAvailable: boolean;
    requiredCheckType: 'daily' | 'weekly' | null;
  } | null;
  latestPayslip: {
    id: string;
    payPeriodStart: string;
    payPeriodEnd: string;
    hasPdf: boolean;
  } | null;
  latestReceipt: {
    id: string;
    vendor: string | null;
    totalCents: number;
    capturedAt: string;
  } | null;
  pendingCorrectionsCount: number;
  recentEntryCount: number;
  requiredAttendanceAction: RequiredAttendanceAction | null;
  fleetIncidents: FleetIncidentHubCounts;
}

export interface FleetIncidentHubCounts {
  inputRequestedCount: number;
  activeCount: number;
}

interface VehicleCheckReminderRow extends Record<string, unknown> {
  vehicle_id: string;
  required_check_type: 'daily' | 'weekly' | null;
}

interface VehicleCheckReminderResult {
  available: boolean;
  reminder: VehicleCheckReminderRow | null;
}

async function findVehicleCheckReminder(
  registration: string | null
): Promise<VehicleCheckReminderResult> {
  if (!registration) return { available: true, reminder: null };

  try {
    const rows = await sql<VehicleCheckReminderRow>`
      WITH sast_today AS (
        SELECT
          (NOW() AT TIME ZONE 'Africa/Johannesburg')::date AS work_date,
          EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Africa/Johannesburg')::int AS weekday
      )
      SELECT
        v.id AS vehicle_id,
        CASE
          WHEN d.weekday = 1
            AND (
              s.weekly_last_check IS NULL
              OR s.weekly_last_check < d.work_date - 6
            )
            THEN 'weekly'
          WHEN s.weekly_last_check = d.work_date
            OR s.daily_last_check = d.work_date
            THEN NULL
          ELSE 'daily'
        END AS required_check_type
      FROM fleet_vehicles v
      CROSS JOIN sast_today d
      LEFT JOIN fleet_check_schedule s ON s.vehicle_id = v.id
      WHERE v.registration = ${registration}
        AND v.status = 'active'
      LIMIT 1
    `;
    return {
      available: rows.length > 0,
      reminder: rows[0] ?? null,
    };
  } catch (error) {
    log.warn('[my/hub-summary] vehicle check reminder unavailable', {
      error,
      registration,
    });
    return { available: false, reminder: null };
  }
}

/**
 * Bounded to the driver's currently-visible (recent-window) incidents —
 * `listDriverIncidents` already applies the effective-dated settings/window
 * filtering (design §4/§12), so this reuses that instead of a second,
 * possibly-drifting SQL predicate. Never throws — a badge count
 * unavailable is not worth failing the whole hub for (matches
 * `findVehicleCheckReminder`'s own fail-open shape above).
 *
 * Deliberately bounded rather than derived from the full result set
 * (this task's ruling): `driverInputState`/`lifecyclePresentation` are
 * computed by `./inputState.ts`'s pure five-state machine (SAST calendar
 * math, settings-driven post-closure windows) precisely so that logic
 * stays in one drift-free JS implementation instead of a second,
 * SQL-only copy — re-deriving it here to count past this route's own
 * `limit: 100` page (this module's MAX_LIMIT) would reintroduce exactly
 * that duplication risk for a badge count. `total` (already computed by
 * `listDriverIncidents`, previously discarded here) is compared against
 * the page actually read so a truncation is not silent: for one driver's
 * recent (default 90-day) window, seeing more than 100 incidents would
 * itself be far outside any realistic operational volume, so this is
 * logged for visibility rather than treated as an error.
 */
async function loadFleetIncidentHubCounts(staffId: string): Promise<FleetIncidentHubCounts> {
  try {
    const { incidents, total } = await listDriverIncidents(staffId, { limit: 100 });
    if (total > incidents.length) {
      log.warn('[my/hub-summary] fleet incident hub counts truncated to the first page', {
        staffId, total, countedIncidents: incidents.length,
      });
    }
    return {
      inputRequestedCount: incidents.filter((incident) => incident.driverInputState === 'requested').length,
      activeCount: incidents.filter((incident) => incident.lifecyclePresentation !== 'Closed').length,
    };
  } catch (error) {
    log.warn('[my/hub-summary] fleet incident counts unavailable', { error, staffId });
    return { inputRequestedCount: 0, activeCount: 0 };
  }
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const today = sastWorkDate(new Date());
    const [
      openEntry,
      vehicle,
      correctionCounts,
      recentRows,
      latestPayslip,
      latestReceipt,
      requiredAttendanceAction,
      fleetIncidents,
    ] = await Promise.all([
      findOpenEntry(session.staffId),
      findActiveVehicleAssignment(session.staffId),
      countOwnAdjustmentsByStatus(session.staffId),
      sql<{ count: string }>`
        SELECT COUNT(*)::text AS count
        FROM attendance_entries
        WHERE staff_id = ${session.staffId}
          AND clock_in_at >= NOW() - INTERVAL '14 days'
      `,
      findLatestPayslipForStaff(session.staffId),
      findLatestReceiptForStaff(session.staffId),
      findRequiredAttendanceAction(session.staffId, today),
      loadFleetIncidentHubCounts(session.staffId),
    ]);
    const vehicleReminder = await findVehicleCheckReminder(
      vehicle?.vehicle_registration ?? null
    );

    const now = Date.now();
    const clockInDate = openEntry ? new Date(openEntry.clock_in_at as string | Date) : null;
    const summary: HubSummary = {
      openEntry: openEntry && clockInDate
        ? {
            id: openEntry.id,
            clockInAt: clockInDate.toISOString(),
            durationMs: Math.max(0, now - clockInDate.getTime()),
          }
        : null,
      assignedVehicle: vehicle
        ? {
            id: vehicle.id,
            vehicleId: vehicleReminder.reminder?.vehicle_id ?? null,
            registration: vehicle.vehicle_registration,
            checkStatusAvailable: vehicleReminder.available,
            requiredCheckType:
              vehicleReminder.reminder?.required_check_type ?? null,
          }
        : null,
      latestPayslip,
      latestReceipt,
      pendingCorrectionsCount: correctionCounts.pending,
      recentEntryCount: Number(recentRows[0]?.count ?? '0'),
      requiredAttendanceAction,
      fleetIncidents,
    };

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('[my/hub-summary] failed', { error, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to load hub summary');
  }
});
