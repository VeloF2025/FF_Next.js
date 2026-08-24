/**
 * Typed browser client for the Fleet manager incident-review queue and its
 * compact settings dialog (Task 8). Mirrors the proven envelope/error/abort
 * handling in `../../operations/web/operationsPresentationApi.ts` — the same
 * `{success,data}` / `{success,error:{code,message}}` envelope, the same
 * 401/403 -> `kind: 'permission'` classification, and the same
 * AbortController-per-request pattern the `useIncidentQueue` polling hook
 * below reuses. URL-backed queue filters live here too (not a separate
 * file — Task 8's deliverable list is exact) so `IncidentQueue.tsx` stays a
 * composition/render file under the 200-line component cap.
 *
 * Unlike `useOperationalOverview`, a permission failure here is rendered
 * (never swallowed into `return null`) — `IncidentQueue` needs a visibly
 * distinct permission-denied state, so `error.kind` is exposed rather than
 * hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { INCIDENT_TYPES, SEVERITIES } from '../reviewValidation';
import type {
  ActiveUserOption, IncidentDetail, IncidentEvidence, IncidentLifecycleStatus, IncidentListResult, IncidentOutcome,
  IncidentRule, IncidentRuleChangeRequest, IncidentSeverity, IncidentTransitionResult, IncidentType,
  OversightMembership,
} from '../types';
import type {
  DriverConcernCategory, DriverInputRequestResult, DriverInputSettings,
} from '../driver/types';
export type { ActiveUserOption };

const LIFECYCLE_STATUSES: readonly IncidentLifecycleStatus[] = ['open', 'acknowledged', 'under_review', 'resolved', 'dismissed'];

export interface IncidentQueueFilters {
  lifecycleStatus?: IncidentLifecycleStatus;
  projectId?: string;
  managerUserId?: string;
  incidentType?: IncidentType;
  severity?: IncidentSeverity;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
  overdueOnly?: boolean;
  conditionState?: 'active' | 'cleared';
  evidenceState?: 'required' | 'present';
}

const STRING_FILTER_KEYS = ['projectId', 'managerUserId', 'staffId', 'fromDate', 'toDate'] as const;

function toParams(source: string | URLSearchParams): URLSearchParams {
  return typeof source === 'string' ? new URLSearchParams(source.startsWith('?') ? source.slice(1) : source) : source;
}

export function parseIncidentQueueFilters(source: string | URLSearchParams): IncidentQueueFilters {
  const params = toParams(source);
  const filters: IncidentQueueFilters = {};
  for (const key of STRING_FILTER_KEYS) { const value = params.get(key); if (value) filters[key] = value; }
  const lifecycleStatus = params.get('lifecycleStatus');
  if (lifecycleStatus && LIFECYCLE_STATUSES.includes(lifecycleStatus as IncidentLifecycleStatus)) filters.lifecycleStatus = lifecycleStatus as IncidentLifecycleStatus;
  const incidentType = params.get('incidentType');
  if (incidentType && INCIDENT_TYPES.includes(incidentType as IncidentType)) filters.incidentType = incidentType as IncidentType;
  const severity = params.get('severity');
  if (severity && SEVERITIES.includes(severity as IncidentSeverity)) filters.severity = severity as IncidentSeverity;
  const conditionState = params.get('conditionState');
  if (conditionState === 'active' || conditionState === 'cleared') filters.conditionState = conditionState;
  const evidenceState = params.get('evidenceState');
  if (evidenceState === 'required' || evidenceState === 'present') filters.evidenceState = evidenceState;
  if (params.get('overdueOnly') === 'true') filters.overdueOnly = true;
  return filters;
}

export function serializeIncidentQueueFilters(filters: IncidentQueueFilters): string {
  const params = new URLSearchParams();
  for (const key of STRING_FILTER_KEYS) { const value = filters[key]; if (value) params.set(key, value); }
  if (filters.lifecycleStatus) params.set('lifecycleStatus', filters.lifecycleStatus);
  if (filters.incidentType) params.set('incidentType', filters.incidentType);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.conditionState) params.set('conditionState', filters.conditionState);
  if (filters.evidenceState) params.set('evidenceState', filters.evidenceState);
  if (filters.overdueOnly) params.set('overdueOnly', 'true');
  return params.toString();
}

/**
 * True when at least one narrowing filter (beyond pagination) is active — distinguishes
 * "no incidents" from "no filter results".
 *
 * Checks values, not keys. FilterBar clears a field with
 * `{ ...filters, [key]: event.target.value || undefined }`, and spreading an explicit
 * `undefined` still leaves the key present, so `Object.keys().length` stays above zero
 * once any field has ever been touched. Keying off that told a manager who had just reset
 * every filter back to "Any" that results were still filtered.
 */
export function hasActiveIncidentFilters(filters: IncidentQueueFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

type ApiErrorKind = 'permission' | 'transient';
interface ApiSuccessEnvelope<T> { success: true; data: T }
interface ApiErrorEnvelope { success: false; error: { code: string; message: string } }

export class IncidentApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public kind: ApiErrorKind = status === 401 || status === 403 ? 'permission' : 'transient',
  ) {
    super(message);
    this.name = 'IncidentApiError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError' || error instanceof Error && error.name === 'AbortError';
}
export function isIncidentApiAbort(error: unknown): boolean { return isAbortError(error); }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isSuccessEnvelope<T>(value: unknown): value is ApiSuccessEnvelope<T> {
  return isRecord(value) && value.success === true && Object.prototype.hasOwnProperty.call(value, 'data');
}
function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new IncidentApiError('Fleet incident request failed', 0, 'NETWORK_ERROR');
  }
  let body: unknown;
  try { body = await response.json() as unknown; } catch { throw new IncidentApiError('Fleet incident response was invalid', response.status, 'INVALID_RESPONSE'); }
  if (isErrorEnvelope(body)) throw new IncidentApiError(body.error.message, response.status, body.error.code);
  if (!response.ok || !isSuccessEnvelope<T>(body)) throw new IncidentApiError('Fleet incident response was invalid', response.status, 'INVALID_RESPONSE');
  return body.data;
}

/** Shared with `incidentTimelineApi.ts` so there is one envelope decoder, not two. */
export { request as incidentRequest };

export interface IncidentActionBody {
  actionType: 'acknowledged' | 'review_started' | 'commented' | 'resolved' | 'dismissed';
  note?: string | null;
  outcome?: IncidentOutcome | null;
  linkedIncidentReference?: string | null;
}
export interface EvidenceUploadBody {
  evidenceType: 'photo' | 'document';
  mimeType: string;
  base64: string;
  filename?: string | null;
  description?: string | null;
}
export interface BulkAcknowledgeItemResult { incidentId: string; lifecycleStatus: IncidentLifecycleStatus; actionId: string }
export interface BulkAcknowledgeConflict { incidentId: string; lifecycleStatus: IncidentLifecycleStatus }
/** `conflicts` holds ids another manager closed between validation and this call's own row lock. The rest still committed — the batch is never all-or-nothing once it starts mutating. */
export interface BulkAcknowledgeResult { results: BulkAcknowledgeItemResult[]; conflicts: BulkAcknowledgeConflict[] }
export interface IncidentEvidenceUploadResult { evidence: IncidentEvidence; actionId: string }
interface UserSearchResponse { users: ActiveUserOption[] }
export interface DriverInputRequestBody { guidance?: string | null; respondBy?: string | null; idempotencyKey: string }
/** Mirrors `settingsRepository.ts`'s `DriverInputSettingsChangeRequest` field-for-field —
 * declared locally rather than imported so this client module never pulls in that
 * server-only file's `@/lib/db-pool` dependency, even transitively via a bare `import type`. */
export interface DriverInputSettingsRequestBody {
  responseWindowWorkdays: number;
  postClosureResponseEnabled: boolean;
  postClosureResponseWindowDays: number;
  recentWindowDays: number;
  historyWindowDays: number;
  enabledConcernCategories: DriverConcernCategory[];
  evidenceAllowedMimeTypes: string[];
  evidenceMaxBytes: number;
  driverInputRequestedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
  driverResponseReceivedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
  effectiveFrom: string;
  changeReason?: string | null;
}

export const incidentApi = {
  list(filters: IncidentQueueFilters, page: { page: number; limit: number }, signal?: AbortSignal): Promise<IncidentListResult> {
    const params = new URLSearchParams(serializeIncidentQueueFilters(filters));
    params.set('page', String(page.page));
    params.set('limit', String(page.limit));
    return request(`/api/fleet/incidents?${params.toString()}`, { signal });
  },
  detail(incidentId: string, signal?: AbortSignal): Promise<IncidentDetail> {
    return request(`/api/fleet/incidents/${encodeURIComponent(incidentId)}`, { signal });
  },
  act(incidentId: string, body: IncidentActionBody): Promise<IncidentTransitionResult> {
    return request(`/api/fleet/incidents/${encodeURIComponent(incidentId)}/actions`, { method: 'POST', body: JSON.stringify(body) });
  },
  bulkAcknowledge(incidentIds: string[]): Promise<BulkAcknowledgeResult> {
    return request('/api/fleet/incidents/bulk-acknowledge', { method: 'POST', body: JSON.stringify({ incidentIds }) });
  },
  uploadEvidence(incidentId: string, body: EvidenceUploadBody): Promise<IncidentEvidenceUploadResult> {
    return request(`/api/fleet/incidents/${encodeURIComponent(incidentId)}/evidence`, { method: 'POST', body: JSON.stringify(body) });
  },
  requestDriverInput(incidentId: string, body: DriverInputRequestBody): Promise<DriverInputRequestResult> {
    return request(`/api/fleet/incidents/${encodeURIComponent(incidentId)}/request-driver-input`, { method: 'POST', body: JSON.stringify(body) });
  },
  getDriverInputSettings(signal?: AbortSignal): Promise<DriverInputSettings> {
    return request('/api/fleet/incidents/settings/driver-input', { signal });
  },
  versionDriverInputSettings(body: DriverInputSettingsRequestBody): Promise<DriverInputSettings> {
    return request('/api/fleet/incidents/settings/driver-input', { method: 'POST', body: JSON.stringify(body) });
  },
  listRules(incidentType: IncidentType, signal?: AbortSignal): Promise<IncidentRule[]> {
    return request(`/api/fleet/incidents/settings/rules?incidentType=${encodeURIComponent(incidentType)}`, { signal });
  },
  createRuleVersion(body: Omit<IncidentRuleChangeRequest, 'actorUserId'>): Promise<IncidentRule> {
    return request('/api/fleet/incidents/settings/rules', { method: 'POST', body: JSON.stringify(body) });
  },
  listOversightMembers(activeOnly: boolean, signal?: AbortSignal): Promise<OversightMembership[]> {
    return request(`/api/fleet/incidents/settings/oversight-members?activeOnly=${activeOnly}`, { signal });
  },
  addOversightMember(body: { userId: string; effectiveFrom?: string; reason: string | null }): Promise<OversightMembership> {
    return request('/api/fleet/incidents/settings/oversight-members', { method: 'POST', body: JSON.stringify(body) });
  },
  endOversightMembership(body: { membershipId: string; reason: string }): Promise<OversightMembership> {
    return request('/api/fleet/incidents/settings/oversight-members', { method: 'DELETE', body: JSON.stringify(body) });
  },
  /** Scoped to `fleet.incidents-settings:edit` (never `/api/admin/users`, which requires the `admin` role and
   * would 403 a non-admin holding that permission via an active override grant — see `reviewScope.ts`). */
  searchActiveUsers(searchTerm: string, signal?: AbortSignal): Promise<ActiveUserOption[]> {
    const params = new URLSearchParams({ search: searchTerm });
    return request<UserSearchResponse>(`/api/fleet/incidents/settings/user-search?${params.toString()}`, { signal }).then((data) => data.users);
  },
  /** Resolves display names for oversight-membership rows so they never render the raw `userId` UUID. */
  resolveOversightUserNames(userIds: string[], signal?: AbortSignal): Promise<ActiveUserOption[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    const params = new URLSearchParams({ ids: userIds.join(',') });
    return request<UserSearchResponse>(`/api/fleet/incidents/settings/user-search?${params.toString()}`, { signal }).then((data) => data.users);
  },
  /**
   * Backs the queue's "Project" filter picker. Deliberately `/api/projects` (gated by plain
   * `withAuth`, the app-wide project list every signed-in user can search — the same source
   * `SOWProjectSelector`/`ProcurementProjectSelector` read from) rather than
   * `/api/fleet/operations/project-options`, which is scoped to `fleet.operations-status:view`
   * — a different permission from `fleet.incidents:view`, and one an incidents-only viewer
   * would not hold. Reusing it here would 403 exactly the audience this filter is for.
   */
  searchProjects(searchTerm: string, signal?: AbortSignal): Promise<ActiveUserOption[]> {
    const params = new URLSearchParams({ search: searchTerm, limit: '20' });
    return request<Array<{ id: string; name: string }>>(`/api/projects?${params.toString()}`, { signal })
      .then((data) => data.map((project) => ({ id: project.id, name: project.name })));
  },
  /** Backs the queue's "Staff" filter picker. `/api/staff` is likewise gated by plain
   * `withAuth`, not a `fleet.*` permission — safe for the same incidents-only audience. */
  searchStaff(searchTerm: string, signal?: AbortSignal): Promise<ActiveUserOption[]> {
    const params = new URLSearchParams({ search: searchTerm });
    return request<Array<{ id: string; name: string }>>(`/api/staff?${params.toString()}`, { signal })
      .then((data) => data.map((staff) => ({ id: staff.id, name: staff.name })));
  },
  /**
   * Resolves one project id to its display name for `IncidentIdFilter`'s deep-link case
   * (`?projectId=…` from `MapAttentionPanel`). Deliberately `?id=` — `searchProjects`'s
   * `?search=` matches against `project_name`/`project_code` text, so passing a raw UUID
   * into it never matches anything and the filter would silently render the id forever.
   */
  resolveProject(id: string, signal?: AbortSignal): Promise<ActiveUserOption | null> {
    return request<{ id: string; name: string }>(`/api/projects?id=${encodeURIComponent(id)}`, { signal })
      .then((project) => ({ id: project.id, name: project.name })).catch(() => null);
  },
  /** Resolves one staff id to its display name — same reasoning as `resolveProject`. */
  resolveStaffMember(id: string, signal?: AbortSignal): Promise<ActiveUserOption | null> {
    return request<{ id: string; name: string }>(`/api/staff?id=${encodeURIComponent(id)}`, { signal })
      .then((staff) => ({ id: staff.id, name: staff.name })).catch(() => null);
  },
};

const POLL_INTERVAL_MS = 30_000;

export interface IncidentQueueState { data: IncidentListResult | null; error: IncidentApiError | null; loading: boolean; refresh: () => Promise<void> }
interface InternalState { key: string; data: IncidentListResult | null; error: IncidentApiError | null; loading: boolean }

/** Visibility-aware polling for the queue: pauses while the tab is hidden and resumes (with an immediate refresh) when it becomes visible again. */
export function useIncidentQueue(filters: IncidentQueueFilters, page: number, limit: number): IncidentQueueState {
  const filterKey = `${serializeIncidentQueueFilters(filters)}|page=${page}|limit=${limit}`;
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<InternalState>({ key: filterKey, data: null, error: null, loading: true });

  // Depends only on primitives (`filterKey`, `page`, `limit`) plus `filters` — never on a
  // freshly-allocated object — so this identity is stable across renders that do not
  // actually change the query, and the polling effect below never re-fires spuriously.
  const refresh = useCallback(async (): Promise<void> => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const requestGeneration = ++generation.current;
    setState((previous) => (previous.key === filterKey ? { ...previous, loading: true } : { key: filterKey, data: null, error: null, loading: true }));
    try {
      const data = await incidentApi.list(filters, { page, limit }, requestController.signal);
      if (requestController.signal.aborted || generation.current !== requestGeneration) return;
      setState({ key: filterKey, data, error: null, loading: false });
    } catch (error) {
      if (isIncidentApiAbort(error) || requestController.signal.aborted || generation.current !== requestGeneration) return;
      const typed = error instanceof IncidentApiError ? error : new IncidentApiError('Fleet incident queue request failed', 0, 'UNKNOWN_ERROR');
      setState((previous) => (previous.key === filterKey ? { ...previous, error: typed, loading: false } : { key: filterKey, data: null, error: typed, loading: false }));
    }
  }, [filterKey, filters, page, limit]);

  useEffect(() => {
    void refresh();
    let timer: number | undefined;
    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const start = () => { if (timer === undefined && isVisible()) timer = window.setInterval(() => { if (isVisible()) void refresh(); }, POLL_INTERVAL_MS); };
    const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const onVisibility = () => { if (isVisible()) { start(); void refresh(); } else stop(); };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); controller.current?.abort(); };
  }, [filterKey, refresh]);

  const visible = state.key === filterKey ? state : { key: filterKey, data: null, error: null, loading: true };
  return { data: visible.data, error: visible.error, loading: visible.loading, refresh };
}
