/**
 * Driver-facing canonical Attendance correction affordance (PR7 Task 6,
 * design §8). Fetches eligibility from the Fleet-owned
 * `/api/my/fleet/incidents/{incidentId}/attendance-correction-link`
 * endpoint and either offers a link into Attendance's own
 * `/my/attendance/corrections/new` flow (carrying only the exception and
 * incident ids — never staff identity or mutable incident state) or
 * renders neutral, non-accusatory copy for why it is not currently
 * offered (design §4: no "fraud"/"misconduct"/"violation" wording).
 *
 * `linkAttendanceCorrection` below is also imported directly by
 * `pages/my/attendance/corrections/new.tsx` to record the link once
 * Attendance's own submission succeeds — this file is the one place that
 * owns the Fleet-side fetch contract for this endpoint.
 */
import React from 'react';
import Link from 'next/link';
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

const INELIGIBLE_COPY: Record<Extract<AttendanceCorrectionEligibility, { eligible: false }>['reason'], string> = {
  no_required_exception: 'No attendance correction is currently required for this incident.',
  period_locked: 'The attendance period for this date is locked. Contact your supervisor to request an unlock.',
  outside_response_window: 'The window to submit an attendance correction for this incident has closed.',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; eligibility: AttendanceCorrectionEligibility };

interface AttendanceCorrectionLinkProps {
  incidentId: string;
}

export function AttendanceCorrectionLink({ incidentId }: AttendanceCorrectionLinkProps): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchAttendanceCorrectionEligibility(incidentId)
      .then((eligibility) => { if (!cancelled) setState({ status: 'ready', eligibility }); })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not check attendance correction eligibility.',
        });
      });
    return () => { cancelled = true; };
  }, [incidentId]);

  if (state.status === 'loading') {
    return <p className="text-sm text-neutral-400">Checking attendance correction eligibility…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert" className="text-sm text-red-300">{state.message}</p>;
  }
  if (!state.eligibility.eligible) {
    return <p className="text-sm text-neutral-400">{INELIGIBLE_COPY[state.eligibility.reason]}</p>;
  }

  const href = `/my/attendance/corrections/new?exception_id=${encodeURIComponent(state.eligibility.exceptionId)}&incident_id=${encodeURIComponent(incidentId)}`;
  return (
    <Link
      href={href}
      className="inline-flex touch-manipulation items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 active:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
    >
      Correct attendance
    </Link>
  );
}
