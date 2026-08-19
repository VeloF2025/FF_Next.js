/**
 * Driver-facing Fleet incident detail (PR7 Task 7, design §§4, 8, 15).
 * Renders the driver-visible timeline, the Attendance correction
 * affordance, and the optional response form — all driven entirely by
 * the already-privacy-filtered `DriverIncidentDetail` DTO the server
 * returns; this component never reaches for a field the DTO does not
 * expose (see `../types.ts`'s own docstring on why `incidentType`/
 * `severity` are absent from that shape).
 *
 * Closes a known gap (this task's own remit, not in the original PR7
 * plan's Task 7 file list): once a driver's Attendance correction
 * submission succeeds but the Fleet-side link POST fails, the retry
 * button on `pages/my/attendance/corrections/new.tsx` only lives in that
 * page's own React state — leaving once discards it forever. That page
 * now also records the failed attempt in `localStorage` keyed by incident
 * id; this component reads it back so the driver has a durable retry path
 * that survives navigating away (and even closing the app), using the
 * same `linkMyAttendanceCorrection` call that page already uses.
 */
import React from 'react';
import type { DriverIncidentDetail as DriverIncidentDetailDto } from '../types';
import { AttendanceCorrectionLink } from './AttendanceCorrectionLink';
import { DriverResponseForm } from './DriverResponseForm';
import { DriverIncidentApiError, getMyFleetIncident, linkMyAttendanceCorrection } from './driverIncidentApi';
import {
  DRIVER_INPUT_STATE_LABELS, RESPONSE_INELIGIBLE_COPY, formatIncidentDateTime, pendingCorrectionStorageKey,
} from './driverPortalLabels';

export interface DriverIncidentDetailProps {
  incidentId: string;
}

function readPendingCorrectionId(incidentId: string): string | null {
  try {
    return window.localStorage.getItem(pendingCorrectionStorageKey(incidentId));
  } catch {
    return null; // Storage unavailable (private mode, SSR) — the retry section simply does not offer itself.
  }
}

function clearPendingCorrectionId(incidentId: string): void {
  try { window.localStorage.removeItem(pendingCorrectionStorageKey(incidentId)); } catch { /* best-effort cleanup only */ }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: DriverIncidentDetailDto };

export function DriverIncidentDetail({ incidentId }: DriverIncidentDetailProps): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [pendingCorrectionId, setPendingCorrectionId] = React.useState<string | null>(null);
  const [retryStatus, setRetryStatus] = React.useState<'idle' | 'retrying' | 'success' | 'error'>('idle');
  const [retryError, setRetryError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPendingCorrectionId(readPendingCorrectionId(incidentId));
  }, [incidentId]);

  const loadDetail = React.useCallback((): (() => void) => {
    let cancelled = false;
    setState({ status: 'loading' });
    getMyFleetIncident(incidentId)
      .then((detail) => { if (!cancelled) setState({ status: 'ready', detail }); })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DriverIncidentApiError && error.status === 404) {
          setState({ status: 'not-found' });
          return;
        }
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load this incident.' });
      });
    return () => { cancelled = true; };
  }, [incidentId]);

  React.useEffect(() => loadDetail(), [loadDetail]);

  const handleRetryLink = React.useCallback(async () => {
    if (!pendingCorrectionId) return;
    setRetryStatus('retrying');
    setRetryError(null);
    try {
      await linkMyAttendanceCorrection(incidentId, pendingCorrectionId);
      clearPendingCorrectionId(incidentId);
      setPendingCorrectionId(null);
      setRetryStatus('success');
    } catch (error) {
      setRetryStatus('error');
      setRetryError(error instanceof Error ? error.message : 'Could not link the correction. You can try again.');
    }
  }, [incidentId, pendingCorrectionId]);

  if (state.status === 'loading') return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (state.status === 'not-found') {
    return <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-400">Incident not found.</div>;
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
        Could not load this incident. {state.message}
      </div>
    );
  }

  const { detail } = state;

  return (
    <div className="space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-neutral-100">{detail.incidentReference}</h1>
          <span className="rounded-full border border-blue-700 bg-blue-950/50 px-2 py-0.5 text-[11px] font-medium text-blue-200">
            {DRIVER_INPUT_STATE_LABELS[detail.driverInputState]}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-300">{detail.neutralLabel}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {[detail.projectLabel, detail.siteLabel].filter(Boolean).join(' · ')}
          {detail.projectLabel || detail.siteLabel ? ' · ' : ''}
          {formatIncidentDateTime(detail.detectedAt)} · {detail.lifecyclePresentation}
        </p>
      </header>

      {detail.currentRequest?.guidance && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300">{detail.currentRequest.guidance}</div>
      )}

      <TimelineSection timeline={detail.timeline} />

      <section>
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Attendance correction</h2>
        <AttendanceCorrectionLink incidentId={incidentId} />
        {pendingCorrectionId && retryStatus !== 'success' && (
          <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            <p>A previous attempt to link your attendance correction to this incident did not complete.</p>
            {retryError && <p role="alert" className="mt-1 text-amber-100">{retryError}</p>}
            <button
              type="button"
              onClick={() => void handleRetryLink()}
              disabled={retryStatus === 'retrying'}
              className="mt-2 touch-manipulation rounded-lg border border-amber-700 px-3 py-1.5 text-sm font-semibold text-amber-200 hover:bg-amber-950/60 disabled:opacity-50"
            >
              {retryStatus === 'retrying' ? 'Linking…' : 'Retry linking correction'}
            </button>
          </div>
        )}
        {retryStatus === 'success' && <p className="mt-2 text-sm text-emerald-300">Linked.</p>}
      </section>

      {detail.responseEligible ? (
        <DriverResponseForm
          incidentId={incidentId}
          enabledConcernCategories={detail.enabledConcernCategories}
          hasResponded={detail.ownSubmissions.length > 0}
          onSubmitted={() => loadDetail()}
        />
      ) : (
        detail.responseIneligibleReason && (
          <p className="text-sm text-neutral-400">{RESPONSE_INELIGIBLE_COPY[detail.responseIneligibleReason]}</p>
        )
      )}
    </div>
  );
}

function TimelineSection({ timeline }: { timeline: DriverIncidentDetailDto['timeline'] }): React.ReactElement | null {
  if (timeline.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-neutral-200">Timeline</h2>
      <ul className="space-y-1 text-sm text-neutral-300">
        {timeline.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
            <span className="font-medium text-neutral-200">{entry.label}</span>
            <span className="ml-2 text-xs text-neutral-500">{formatIncidentDateTime(entry.occurredAt)}</span>
            {entry.note && <p className="mt-1 text-xs text-neutral-400">{entry.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
