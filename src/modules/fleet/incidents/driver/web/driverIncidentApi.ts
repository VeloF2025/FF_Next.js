/**
 * Typed fetch wrappers for the driver-facing `/api/my/fleet/incidents`
 * routes (PR7 Task 7, design §14). Deliberately self-contained rather than
 * importing `ApiError`/`request` from `@/modules/attendance/portal/client/api`
 * — `./AttendanceCorrectionLink.tsx` (PR7 Task 6) already made that same
 * call for this exact directory, to keep `fleet/incidents/driver` decoupled
 * from the Attendance portal module.
 *
 * Every call is `credentials: 'include'` (the `/my` session cookie) and
 * never accepts a caller-supplied staff id — the server derives
 * `session.staffId` from the cookie itself (design §10).
 */
import type {
  DriverConcernCategory, DriverEvidenceResult, DriverIncidentDetail, DriverIncidentListResponse,
  DriverSubmissionKind, DriverSubmissionResult,
} from '../types';

export { fetchAttendanceCorrectionEligibility, linkAttendanceCorrection as linkMyAttendanceCorrection } from './AttendanceCorrectionLink';

export class DriverIncidentApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DriverIncidentApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    // Offline / DNS / aborted — never surfaced as a generic API error so
    // the UI can show "you're offline" instead of "something went wrong".
    throw new DriverIncidentApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new DriverIncidentApiError(response.status, 'PARSE_ERROR', `Server returned non-JSON (HTTP ${response.status})`);
  }

  if (!response.ok || !envelope.success || envelope.data === undefined) {
    const err = envelope.error ?? { code: 'UNKNOWN', message: `HTTP ${response.status}` };
    throw new DriverIncidentApiError(response.status, err.code, err.message, err.details);
  }
  return envelope.data;
}

function incidentsPath(): string { return '/api/my/fleet/incidents'; }
function incidentPath(incidentId: string): string { return `/api/my/fleet/incidents/${encodeURIComponent(incidentId)}`; }

export interface ListMyFleetIncidentsParams {
  history?: boolean;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export function listMyFleetIncidents(params: ListMyFleetIncidentsParams = {}): Promise<DriverIncidentListResponse> {
  const qs = new URLSearchParams();
  if (params.history) qs.set('history', 'true');
  if (params.fromDate) qs.set('fromDate', params.fromDate);
  if (params.toDate) qs.set('toDate', params.toDate);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return requestJson<DriverIncidentListResponse>(`${incidentsPath()}${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function getMyFleetIncident(incidentId: string): Promise<DriverIncidentDetail> {
  return requestJson<DriverIncidentDetail>(incidentPath(incidentId), { method: 'GET' });
}

export interface SubmitMyFleetIncidentResponseArgs {
  submissionKind: DriverSubmissionKind;
  explanation: string;
  concernCategory?: DriverConcernCategory | null;
  idempotencyKey: string;
}

export function submitMyFleetIncidentResponse(
  incidentId: string, args: SubmitMyFleetIncidentResponseArgs,
): Promise<DriverSubmissionResult> {
  return requestJson<DriverSubmissionResult>(`${incidentPath(incidentId)}/submissions`, {
    method: 'POST', body: JSON.stringify(args),
  });
}

export interface UploadMyFleetIncidentEvidenceArgs {
  mimeType: string;
  base64: string;
  filename: string | null;
  description: string | null;
}

export function uploadMyFleetIncidentEvidence(
  incidentId: string, args: UploadMyFleetIncidentEvidenceArgs,
): Promise<DriverEvidenceResult> {
  return requestJson<DriverEvidenceResult>(`${incidentPath(incidentId)}/evidence`, {
    method: 'POST', body: JSON.stringify(args),
  });
}
