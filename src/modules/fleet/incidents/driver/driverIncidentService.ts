/**
 * Staff-scoped driver incident reads (PR7 Task 4): list + detail assembled
 * from migration 507's driver-input tables plus PR6's incident/evidence/
 * action tables. `sessionStaffId` is always a required, separate argument
 * derived server-side from the `/my` session — never a field a caller can
 * set on `filters`/the route params (design §10).
 *
 * `computeResponseEligibility` lives here rather than `./inputState.ts`
 * because it decides what this module's own detail read shows in
 * `responseEligible`/`responseIneligibleReason`; `./submissionService.ts`
 * imports it so read and write can never disagree about whether a
 * submission is currently accepted. `DriverInputState` (`./inputState.ts`)
 * is a different, narrower question — see that module's own doc — so a
 * terminal incident that was *never* requested still reports
 * `not_requested` there while this function correctly reports it
 * ineligible.
 */
import { query, queryOne } from '@/lib/db-pool';
import { isValidDate, isValidUUID } from '../../services/mileageUtils';
import { findDriverIncidentDetail, findDriverIncidents, listVisibleTimeline } from './driverInputRepository';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type {
  AttendanceCorrectionState, DriverConcernCategory, DriverCorrectionLinkSummary, DriverIncidentDetail,
  DriverIncidentListResponse, DriverSubmissionKind, DriverSubmissionSummary,
} from './types';

export class DriverIncidentValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverIncidentValidationError'; }
}

export type ResponseIneligibleReason = 'closed' | 'expired' | 'outside_window';
/** Discriminated on `eligible` so `reason` is non-null exactly when `eligible` is `false` — callers narrow with a plain `if (!eligibility.eligible)` and need no cast to read `reason`. */
export type ResponseEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: ResponseIneligibleReason };
export interface ComputeResponseEligibilityArgs {
  /** Server-derived current instant (ISO). */
  now: string;
  currentRequest: { respondBy: string } | null;
  /** `resolved_at` — null while the incident is active. */
  incidentTerminalAt: string | null;
  postClosureResponseEnabled: boolean;
  postClosureResponseWindowDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Three non-overlapping reasons (design §5/§10 list all three; this is this
 * task's ruling on which condition each one names, since the design does
 * not itself spell out the mapping):
 *  - `closed`: the incident is terminal and post-closure response was never
 *    enabled — there was never a window to submit into.
 *  - `outside_window`: the incident is terminal, post-closure response WAS
 *    enabled, but its bounded window has now elapsed.
 *  - `expired`: the incident is still active, but the current request's own
 *    `respondBy` date has passed.
 */
export function computeResponseEligibility(args: ComputeResponseEligibilityArgs): ResponseEligibility {
  const nowMs = new Date(args.now).getTime();
  if (args.incidentTerminalAt !== null) {
    if (!args.postClosureResponseEnabled) return { eligible: false, reason: 'closed' };
    const deadlineMs = new Date(args.incidentTerminalAt).getTime() + args.postClosureResponseWindowDays * DAY_MS;
    return nowMs > deadlineMs ? { eligible: false, reason: 'outside_window' } : { eligible: true, reason: null };
  }
  if (args.currentRequest && nowMs > new Date(args.currentRequest.respondBy).getTime()) {
    return { eligible: false, reason: 'expired' };
  }
  return { eligible: true, reason: null };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface ListDriverIncidentsFilters { history?: boolean; fromDate?: string; toDate?: string; limit?: number; offset?: number }
interface NormalizedFilters { history: boolean; fromDate: string | null; toDate: string | null; limit: number; offset: number }

function validateAndNormalizeFilters(filters: ListDriverIncidentsFilters): NormalizedFilters {
  const history = filters.history === true;
  if (filters.fromDate !== undefined && !isValidDate(filters.fromDate)) throw new DriverIncidentValidationError('fromDate must be a YYYY-MM-DD date');
  if (filters.toDate !== undefined && !isValidDate(filters.toDate)) throw new DriverIncidentValidationError('toDate must be a YYYY-MM-DD date');
  const limit = filters.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DriverIncidentValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new DriverIncidentValidationError('offset must be a non-negative integer');
  return { history, fromDate: filters.fromDate ?? null, toDate: filters.toDate ?? null, limit, offset };
}

/**
 * Staff-scoped incident list. `sessionStaffId` is the sole source of the
 * ownership predicate (enforced in SQL by `findDriverIncidents`) — nothing
 * on `filters` can widen or redirect it.
 */
export async function listDriverIncidents(sessionStaffId: string, filters: ListDriverIncidentsFilters): Promise<DriverIncidentListResponse> {
  const normalized = validateAndNormalizeFilters(filters);
  const now = new Date().toISOString();
  const settings = await getEffectiveDriverInputSettings(now);
  const terminalWindowDays = normalized.history ? settings.historyWindowDays : settings.recentWindowDays;

  // `history=true` expands visibility to the configured maximum, but a
  // caller cannot use `fromDate` to reach further back than that maximum
  // (design §4/§18: PR7 only enforces the configured window when reading
  // retained history — it never exposes anything beyond it).
  if (normalized.history && normalized.fromDate) {
    const oldestAllowedMs = Date.now() - settings.historyWindowDays * DAY_MS;
    if (new Date(normalized.fromDate).getTime() < oldestAllowedMs) {
      throw new DriverIncidentValidationError(`fromDate cannot exceed the configured ${settings.historyWindowDays}-day history window`);
    }
  }

  return findDriverIncidents(sessionStaffId, {
    terminalWindowDays, recentWindowDays: settings.recentWindowDays, historyWindowDays: settings.historyWindowDays,
    postClosureResponseEnabled: settings.postClosureResponseEnabled, postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
    fromDate: normalized.fromDate, toDate: normalized.toDate,
    limit: normalized.limit, offset: normalized.offset, now,
  });
}

interface OwnSubmissionRow extends Record<string, unknown> {
  id: string; submission_kind: DriverSubmissionKind; explanation: string; concern_category: DriverConcernCategory | null; created_at: string | Date;
}
function isoValue(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }

/** Scoped by both incident id and `staff_id` for defense in depth, even though a submission can only ever belong to the one staff member an incident is linked to. */
async function loadOwnSubmissions(sessionStaffId: string, incidentId: string): Promise<DriverSubmissionSummary[]> {
  const rows = await query<OwnSubmissionRow>(
    `SELECT id, submission_kind, explanation, concern_category, created_at FROM fleet_incident_driver_submissions
     WHERE incident_id = $1::uuid AND staff_id = $2::uuid ORDER BY created_at ASC`,
    [incidentId, sessionStaffId],
  );
  return rows.map((row) => ({
    id: row.id, submissionKind: row.submission_kind, explanation: row.explanation,
    concernCategory: row.concern_category, createdAt: isoValue(row.created_at),
  }));
}

interface OwnCorrectionLinkRow extends Record<string, unknown> {
  id: string; attendance_correction_id: string; linked_at: string | Date; status: AttendanceCorrectionState;
}
/**
 * Already-linked corrections and their live Attendance status.
 * `attendance_adjustments.status` uses the same four values as
 * `AttendanceCorrectionState` (verified against
 * `scripts/migrations/sql/320_attendance_corrections_and_locks.sql`).
 * Creating a link is PR7 Task 6's `attendanceCorrectionLinkService.ts`,
 * which does not modify this file — until it ships, nothing ever inserts a
 * row here, so this always returns `[]` in practice; it is still real,
 * staff-scoped read logic rather than a stub, since a Task 6 write becomes
 * visible here with no further change.
 */
async function loadOwnCorrectionLinks(sessionStaffId: string, incidentId: string): Promise<DriverCorrectionLinkSummary[]> {
  const rows = await query<OwnCorrectionLinkRow>(
    `SELECT l.id, l.attendance_correction_id, l.linked_at, a.status
     FROM fleet_incident_attendance_correction_links l
     JOIN attendance_adjustments a ON a.id = l.attendance_correction_id
     WHERE l.incident_id = $1::uuid AND l.staff_id = $2::uuid ORDER BY l.linked_at ASC`,
    [incidentId, sessionStaffId],
  );
  return rows.map((row) => ({
    id: row.id, attendanceCorrectionId: row.attendance_correction_id,
    linkedAt: isoValue(row.linked_at), correctionState: row.status,
  }));
}

interface TerminalRow extends Record<string, unknown> { resolved_at: string | Date | null }
/** One small scoped read for the timestamp `findDriverIncidentDetail`'s mapped `DriverIncidentListItem` deliberately does not expose (it only reports the derived `conditionState`/`lifecyclePresentation`, never a raw timestamp a client could misuse). */
async function loadIncidentTerminalAt(sessionStaffId: string, incidentId: string): Promise<string | null> {
  const row = await queryOne<TerminalRow>(
    `SELECT resolved_at FROM fleet_operational_incidents WHERE id = $1::uuid AND staff_id = $2::uuid`,
    [incidentId, sessionStaffId],
  );
  if (!row || row.resolved_at === null) return null;
  return isoValue(row.resolved_at);
}

/**
 * A single incident's driver-safe detail, or `null` when it does not exist
 * OR belongs to a different staff member — deliberately the same shape for
 * both (design §10 IDOR safety), so an API 404 never confirms another
 * driver's incident exists.
 */
export async function getDriverIncident(sessionStaffId: string, incidentId: string): Promise<DriverIncidentDetail | null> {
  if (!isValidUUID(incidentId)) return null;
  const now = new Date().toISOString();
  const settings = await getEffectiveDriverInputSettings(now);
  const item = await findDriverIncidentDetail(sessionStaffId, incidentId, {
    postClosureResponseEnabled: settings.postClosureResponseEnabled, postClosureResponseWindowDays: settings.postClosureResponseWindowDays, now,
  });
  if (!item) return null;

  const [timeline, ownSubmissions, ownCorrectionLinks, incidentTerminalAt] = await Promise.all([
    listVisibleTimeline(sessionStaffId, incidentId),
    loadOwnSubmissions(sessionStaffId, incidentId),
    loadOwnCorrectionLinks(sessionStaffId, incidentId),
    // NOTE: this read and `findDriverIncidentDetail`'s own `resolved_at`
    // read above are two separate, untransacted SELECTs. A concurrent
    // closure between them can make this payload internally inconsistent
    // (e.g. `lifecyclePresentation: "Open"` alongside
    // `responseIneligibleReason: "closed"`). Read-only and not exploitable
    // — left as-is deliberately, not an oversight.
    loadIncidentTerminalAt(sessionStaffId, incidentId),
  ]);

  const eligibility = computeResponseEligibility({
    now, currentRequest: item.currentRequest ? { respondBy: item.currentRequest.respondBy } : null,
    incidentTerminalAt, postClosureResponseEnabled: settings.postClosureResponseEnabled,
    postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
  });

  // Named field-by-field rather than `{ ...item, ... }`: a spread would
  // forward any field `findDriverIncidentDetail` ever adds in future
  // (`incidentType`/`severity` already leaked into this DTO once — commit
  // fbec56448) with no compiler signal. Naming each driver-safe field here
  // means a new upstream field is excluded by default, not forwarded by
  // default — see `driverIncidentService.test.ts`'s
  // "never forwards an unlisted repository field" test for the regression
  // this guards against.
  return {
    id: item.id, incidentReference: item.incidentReference, neutralLabel: item.neutralLabel,
    projectLabel: item.projectLabel, siteLabel: item.siteLabel, detectedAt: item.detectedAt,
    conditionState: item.conditionState, lifecyclePresentation: item.lifecyclePresentation,
    driverInputState: item.driverInputState, currentRequest: item.currentRequest, respondedAt: item.respondedAt,
    // No safe generator exists yet for a plain-language "why this incident
    // was flagged" summary — the only raw material is `evidenceSnapshot`,
    // which design §4/§9 forbids sending to a driver (it can carry
    // coordinates/provider payloads). Returning `null` here is this task's
    // deliberate ruling rather than an oversight; `neutralLabel` remains
    // the safe, already-shipped summary a driver sees.
    explanationSummary: null,
    timeline, ownSubmissions, ownCorrectionLinks,
    responseEligible: eligibility.eligible, responseIneligibleReason: eligibility.reason,
    enabledConcernCategories: settings.enabledConcernCategories,
  };
}
