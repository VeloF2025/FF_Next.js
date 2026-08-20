/**
 * Driver-input reads (migration 511): incident locking, the current open
 * request, staff-scoped incident list/detail, and the driver-visible
 * timeline. Append-only writes (requests/submissions/correction links) live
 * in `./driverInputWriteRepository.ts` — this file stayed the CRUD/read
 * half once combining both pushed it past the 300-line new-file ratchet,
 * mirroring `../incidentRepository.ts`'s own core-vs-append-only split.
 * Locking mutations still take a caller-supplied `TxnClient` (never open
 * their own transaction); plain reads use the pool `query`/`queryOne`,
 * matching `../reviewQueries.ts`. The owning staff id is always the
 * function's required first argument bound to a single fixed `$1::uuid`
 * placeholder — no options field can override it (design §10).
 */
import { query, queryOne, type TxnClient } from '@/lib/db-pool';
import { deriveDriverInputState } from './inputState';
import type {
  DriverIncidentListItem, DriverIncidentListResponse, DriverIncidentTimelineEntry, DriverInputRequestSummary, DriverInputState,
} from './types';

export function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
export function isoOrNull(value: string | Date | null): string | null { return value === null ? null : iso(value); }

/** Minimal shape both the pool's plain `query`/`queryOne` and a `TxnClient` satisfy, so a read helper can be reused inside or outside a transaction without duplicating its SQL. */
export interface QueryExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
}
export const poolExecutor: QueryExecutor = { query, queryOne };

export const REQUEST_COLUMNS = `id, incident_id, guidance, requested_at, respond_by, superseded_at, closed_at, closure_reason,
  delivery_attempted_count, delivery_accepted_count, delivery_failed_count`;

export interface RequestRow extends Record<string, unknown> {
  id: string; incident_id: string; guidance: string | null; requested_at: string | Date; respond_by: string | Date;
  superseded_at: string | Date | null; closed_at: string | Date | null; closure_reason: string | null;
  delivery_attempted_count: number; delivery_accepted_count: number; delivery_failed_count: number;
}

export interface DriverInputRequestRecord {
  id: string; incidentId: string; guidance: string | null; requestedAt: string; respondBy: string;
  supersededAt: string | null; closedAt: string | null; closureReason: string | null;
  deliveryAttemptedCount: number; deliveryAcceptedCount: number; deliveryFailedCount: number;
}

export function mapRequest(row: RequestRow): DriverInputRequestRecord {
  return {
    id: row.id, incidentId: row.incident_id, guidance: row.guidance, requestedAt: iso(row.requested_at), respondBy: iso(row.respond_by),
    supersededAt: isoOrNull(row.superseded_at), closedAt: isoOrNull(row.closed_at), closureReason: row.closure_reason,
    deliveryAttemptedCount: row.delivery_attempted_count, deliveryAcceptedCount: row.delivery_accepted_count,
    deliveryFailedCount: row.delivery_failed_count,
  };
}

// Incident locking. `terminalAt` mirrors `resolved_at`, set for both terminal lifecycle statuses.
export interface LockedDriverIncidentRecord { id: string; staffId: string; lifecycleStatus: string; terminalAt: string | null }

/** Locks the incident row scoped to both id and staff id in one predicate — a non-owning staff id simply matches no row, indistinguishable from a missing incident id (design §10 IDOR safety). */
export async function lockIncidentForDriver(staffId: string, incidentId: string, txn: TxnClient): Promise<LockedDriverIncidentRecord | null> {
  const row = await txn.queryOne<{ id: string; staff_id: string; lifecycle_status: string; resolved_at: string | Date | null }>(
    `SELECT id, staff_id, lifecycle_status, resolved_at FROM fleet_operational_incidents
     WHERE id = $1::uuid AND staff_id = $2::uuid FOR UPDATE`,
    [incidentId, staffId],
  );
  return row ? { id: row.id, staffId: row.staff_id, lifecycleStatus: row.lifecycle_status, terminalAt: isoOrNull(row.resolved_at) } : null;
}

/** The single currently-open (non-superseded) request for an incident, or null. Takes a `QueryExecutor` so it works both as a plain read (list/detail) and inside a write transaction (superseding a prior request). */
export async function findCurrentInputRequest(incidentId: string, executor: QueryExecutor): Promise<DriverInputRequestRecord | null> {
  const row = await executor.queryOne<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM fleet_incident_driver_input_requests
     WHERE incident_id = $1::uuid AND superseded_at IS NULL
     ORDER BY requested_at DESC LIMIT 1`,
    [incidentId],
  );
  return row ? mapRequest(row) : null;
}

/** Factual, non-disciplinary wording for the driver experience (design §4) — never the internal `incident_type` code or accusatory terms such as "theft"/"fraud"/"misconduct". Exported so other driver-input surfaces (e.g. `./requestInputService.ts`'s notification payload) share this one mapping rather than re-deriving their own. */
export const NEUTRAL_INCIDENT_LABELS: Record<string, string> = {
  late: 'Attendance timing needs review', left_early: 'Attendance timing needs review',
  wrong_site: 'Site assignment needs review', unassigned: 'Assignment record needs review',
  evidence_mismatch: 'Attendance or location record needs review', unverifiable: 'Attendance or location record needs review',
  evidence_gap: 'Attendance or location record needs review',
  vehicle_on_site_driver_unconfirmed: 'Vehicle and site record needs review',
  accident_sos: 'Vehicle safety event needs review', dangerous_area_entry: 'Route record needs review',
  theft_after_hours_movement: 'Vehicle movement needs review', severe_driving: 'Driving behaviour needs review',
  prolonged_unauthorized_stop: 'Route record needs review', lost_contact_moving: 'Vehicle tracking needs review',
};
const NEUTRAL_INCIDENT_LABEL_FALLBACK = 'Vehicle or attendance record needs review';

/** The one neutral-label lookup (with fallback) — used both by the list/detail mapper below and by `./requestInputService.ts`. */
export function neutralIncidentLabel(incidentType: string): string {
  return NEUTRAL_INCIDENT_LABELS[incidentType] ?? NEUTRAL_INCIDENT_LABEL_FALLBACK;
}
const LIFECYCLE_PRESENTATION: Record<string, string> = {
  open: 'Open', acknowledged: 'Being reviewed', under_review: 'Being reviewed', resolved: 'Closed', dismissed: 'Closed',
};

const LIST_ROW_COLUMNS = `i.id, i.incident_reference, i.incident_type, i.severity, i.lifecycle_status,
  i.project_name_snapshot, i.operational_site_name_snapshot, i.detected_at, i.condition_cleared_at, i.resolved_at,
  r.id AS request_id, r.guidance, r.requested_at, r.respond_by,
  (SELECT MAX(sub.created_at) FROM fleet_incident_driver_submissions sub
    WHERE sub.incident_id = i.id AND r.id IS NOT NULL AND sub.created_at >= r.requested_at) AS responded_at`;
const LIST_FROM_JOIN = `FROM fleet_operational_incidents i
  LEFT JOIN LATERAL (
    SELECT id, guidance, requested_at, respond_by FROM fleet_incident_driver_input_requests
    WHERE incident_id = i.id AND superseded_at IS NULL ORDER BY requested_at DESC LIMIT 1
  ) r ON true`;

interface ListRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: string; severity: string; lifecycle_status: string;
  project_name_snapshot: string | null; operational_site_name_snapshot: string | null;
  detected_at: string | Date; condition_cleared_at: string | Date | null; resolved_at: string | Date | null;
  request_id: string | null; guidance: string | null; requested_at: string | Date | null; respond_by: string | Date | null;
  responded_at: string | Date | null;
}

interface MapRowOptions { postClosureResponseEnabled: boolean; postClosureResponseWindowDays: number; now: string }

function mapListRow(row: ListRow, options: MapRowOptions): DriverIncidentListItem {
  const currentRequest: DriverInputRequestSummary | null = row.request_id
    ? { id: row.request_id, guidance: row.guidance, requestedAt: iso(row.requested_at as string | Date), respondBy: iso(row.respond_by as string | Date) }
    : null;
  const respondedAt = isoOrNull(row.responded_at);
  const driverInputState: DriverInputState = deriveDriverInputState({
    now: options.now,
    currentRequest: currentRequest ? { requestedAt: currentRequest.requestedAt, respondBy: currentRequest.respondBy } : null,
    respondedAt, incidentTerminalAt: isoOrNull(row.resolved_at),
    postClosureResponseEnabled: options.postClosureResponseEnabled, postClosureResponseWindowDays: options.postClosureResponseWindowDays,
  });
  return {
    id: row.id, incidentReference: row.incident_reference,
    neutralLabel: neutralIncidentLabel(row.incident_type),
    projectLabel: row.project_name_snapshot, siteLabel: row.operational_site_name_snapshot,
    detectedAt: iso(row.detected_at), conditionState: row.condition_cleared_at ? 'cleared' : 'active',
    lifecyclePresentation: LIFECYCLE_PRESENTATION[row.lifecycle_status] ?? 'Open',
    driverInputState, currentRequest, respondedAt,
  };
}

export interface DriverIncidentListParams {
  /** Include a terminal incident only if `resolved_at` is within this many days of `now` — caller resolves recent(90d)/history(365d) into one number. */
  terminalWindowDays: number;
  /**
   * The configured recent and maximum-history windows, reported back to the caller unchanged.
   * Both are needed: `terminalWindowDays` is whichever ONE the caller filtered by, so deriving
   * the response from it made whichever window the caller did not ask for wrong — a client
   * gating a "View history" control on historyWindowDays > recentWindowDays would never
   * enable it.
   */
  recentWindowDays: number;
  historyWindowDays: number;
  postClosureResponseEnabled: boolean; postClosureResponseWindowDays: number;
  fromDate?: string | null; toDate?: string | null;
  limit: number; offset: number; now: string;
}

function buildDriverIncidentWhere(staffId: string, params: DriverIncidentListParams): { clause: string; sqlParams: unknown[] } {
  const sqlParams: unknown[] = [staffId, params.now, params.terminalWindowDays];
  const conditions = [
    'i.staff_id = $1::uuid',
    '(i.resolved_at IS NULL OR i.resolved_at >= $2::timestamptz - make_interval(days => $3::int))',
  ];
  if (params.fromDate) { sqlParams.push(params.fromDate); conditions.push(`i.detected_at::date >= $${sqlParams.length}::date`); }
  if (params.toDate) { sqlParams.push(params.toDate); conditions.push(`i.detected_at::date <= $${sqlParams.length}::date`); }
  return { clause: `WHERE ${conditions.join(' AND ')}`, sqlParams };
}

/** Staff-scoped incident list. `staffId` is the sole source of the ownership predicate — `params` carries no staff identity field for a caller to override. */
export async function findDriverIncidents(staffId: string, params: DriverIncidentListParams): Promise<DriverIncidentListResponse> {
  const { clause, sqlParams } = buildDriverIncidentWhere(staffId, params);
  const countRow = await queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM fleet_operational_incidents i ${clause}`, sqlParams);
  const limitIdx = sqlParams.length + 1;
  const offsetIdx = sqlParams.length + 2;
  const rows = await query<ListRow>(
    `SELECT ${LIST_ROW_COLUMNS} ${LIST_FROM_JOIN} ${clause} ORDER BY i.detected_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...sqlParams, params.limit, params.offset],
  );
  const options: MapRowOptions = { postClosureResponseEnabled: params.postClosureResponseEnabled, postClosureResponseWindowDays: params.postClosureResponseWindowDays, now: params.now };
  return {
    incidents: rows.map((row) => mapListRow(row, options)),
    total: countRow ? Number(countRow.count) : 0,
    recentWindowDays: params.recentWindowDays, historyWindowDays: params.historyWindowDays,
  };
}

/** A single incident by id, scoped to the owning staff member — no window filtering (a list/business-policy concern), only ownership. */
export async function findDriverIncidentDetail(
  staffId: string, incidentId: string, options: MapRowOptions,
): Promise<DriverIncidentListItem | null> {
  const row = await queryOne<ListRow>(
    `SELECT ${LIST_ROW_COLUMNS} ${LIST_FROM_JOIN} WHERE i.staff_id = $1::uuid AND i.id = $2::uuid`,
    [staffId, incidentId],
  );
  return row ? mapListRow(row, options) : null;
}

const ACTION_TIMELINE_LABELS: Record<string, string> = {
  driver_input_requested: 'Input requested', driver_response_received: 'Driver responded',
  commented: 'Update', evidence_added: 'Evidence added', condition_cleared: 'Condition cleared',
};
const EVIDENCE_TIMELINE_LABELS: Record<string, string> = {
  photo: 'Photo added', document: 'Document added', manager_note: 'Note added', external_reference: 'Reference added',
};

interface TimelineRow extends Record<string, unknown> {
  id: string; source: 'action' | 'evidence'; type_key: string; visibility: string; occurred_at: string | Date; note: string | null;
}

function mapTimelineKind(source: TimelineRow['source'], typeKey: string): DriverIncidentTimelineEntry['kind'] {
  if (source === 'evidence') return 'evidence';
  if (typeKey === 'driver_input_requested') return 'request';
  if (typeKey === 'driver_response_received') return 'submission';
  return 'action';
}
function mapTimelineLabel(source: TimelineRow['source'], typeKey: string): string {
  return source === 'evidence' ? (EVIDENCE_TIMELINE_LABELS[typeKey] ?? 'Evidence added') : (ACTION_TIMELINE_LABELS[typeKey] ?? 'Update');
}

/**
 * Every driver-visible action/evidence row for the incident (`visibility <>
 * 'internal'`, i.e. `shared_with_driver` or `driver_submitted`), newest
 * first. The server applies this filter — never the client (design §9).
 *
 * Scoped by `staffId` in SQL (joined against `fleet_operational_incidents`)
 * so this query is safe standalone rather than depending entirely on its
 * one current caller (`getDriverIncidentService.getDriverIncident`) having
 * already confirmed ownership — mirroring `loadOwnSubmissions`/
 * `loadOwnCorrectionLinks`'s defense-in-depth `staff_id` predicate.
 */
export async function listVisibleTimeline(staffId: string, incidentId: string): Promise<DriverIncidentTimelineEntry[]> {
  const rows = await query<TimelineRow>(
    `SELECT id, 'action' AS source, action_type AS type_key, visibility, occurred_at, note
       FROM fleet_operational_incident_actions
       WHERE incident_id = $1::uuid AND visibility <> 'internal'
         AND EXISTS (SELECT 1 FROM fleet_operational_incidents i WHERE i.id = $1::uuid AND i.staff_id = $2::uuid)
     UNION ALL
     SELECT id, 'evidence' AS source, evidence_type AS type_key, visibility, created_at AS occurred_at, description AS note
       FROM fleet_operational_incident_evidence
       WHERE incident_id = $1::uuid AND visibility <> 'internal'
         AND EXISTS (SELECT 1 FROM fleet_operational_incidents i WHERE i.id = $1::uuid AND i.staff_id = $2::uuid)
     ORDER BY occurred_at DESC`,
    [incidentId, staffId],
  );
  return rows.map((row) => ({
    id: row.id, kind: mapTimelineKind(row.source, row.type_key),
    visibility: row.visibility as DriverIncidentTimelineEntry['visibility'],
    occurredAt: iso(row.occurred_at), label: mapTimelineLabel(row.source, row.type_key), note: row.note,
  }));
}
