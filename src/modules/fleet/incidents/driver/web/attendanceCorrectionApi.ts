/**
 * Fleet-side fetch contract for the driver's canonical Attendance correction
 * endpoint, `/api/my/fleet/incidents/{incidentId}/attendance-correction-link`.
 *
 * This is the one place that owns that contract. It lives beside
 * `AttendanceCorrectionLink.tsx` rather than inside it because two non-React
 * callers need it — `driverIncidentApi.ts` re-exports it, and
 * `pages/my/attendance/corrections/new.tsx` calls `linkAttendanceCorrection`
 * directly to record the link once Attendance's own submission succeeds.
 * Exporting them from the component module made that file export both
 * components and plain functions, which breaks React Fast Refresh.
 *
 * Attendance keeps sole approval authority throughout; nothing here decides
 * whether a correction is granted.
 */
import type { AttendanceCorrectionEligibility, AttendanceCorrectionState } from '../types';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !envelope.success || envelope.data === undefined) {
    throw new Error(envelope.error?.message ?? `Request failed (HTTP ${response.status})`);
  }
  return envelope.data;
}

function correctionLinkPath(incidentId: string): string {
  return `/api/my/fleet/incidents/${encodeURIComponent(incidentId)}/attendance-correction-link`;
}

export function fetchAttendanceCorrectionEligibility(incidentId: string): Promise<AttendanceCorrectionEligibility> {
  return requestJson<AttendanceCorrectionEligibility>(correctionLinkPath(incidentId), { method: 'GET' });
}

export interface AttendanceCorrectionLinkResultDto {
  linkId: string;
  incidentId: string;
  attendanceCorrectionId: string;
  correctionState: AttendanceCorrectionState;
}

export function linkAttendanceCorrection(
  incidentId: string, attendanceCorrectionId: string,
): Promise<AttendanceCorrectionLinkResultDto> {
  return requestJson<AttendanceCorrectionLinkResultDto>(correctionLinkPath(incidentId), {
    method: 'POST',
    body: JSON.stringify({ attendanceCorrectionId }),
  });
}
