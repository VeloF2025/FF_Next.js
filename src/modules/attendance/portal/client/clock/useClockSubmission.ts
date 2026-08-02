import React from 'react';

import { grantSelfieConsent } from '../api';
import { mapConsentError, mapImageError } from '../clockErrors';
import { fileToResizedBase64 } from '../imageUtils';
import { submitClockEventWithOfflineFallback } from '../offline/submitClockEvent';
import type { GpsSnapshot } from '../clockSteps';

export type ClockAction = 'in' | 'out';
export type SubmissionState =
  | 'idle'
  | 'submitting'
  | 'consent_required'
  | 'success'
  | 'queued'
  | 'not_saved'
  | 'error';

export function useClockSubmission(args: {
  action: ClockAction;
  selfieFile: File | null;
  gps: GpsSnapshot | null;
  deviceFingerprint: string | null;
  online: boolean;
  refreshPendingCount: () => Promise<unknown> | unknown;
}) {
  const [state, setState] = React.useState<SubmissionState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [queuedEventId, setQueuedEventId] = React.useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    if (!args.selfieFile) {
      setError('Take a selfie first.');
      setState('error');
      return;
    }
    if (!args.gps) {
      setError('Waiting for GPS. Tap "Get location" below.');
      setState('error');
      return;
    }
    setError(null);
    setQueuedEventId(null);
    setState('submitting');

    let selfieBase64: string;
    try {
      selfieBase64 = await fileToResizedBase64(args.selfieFile);
    } catch (caught) {
      const mapped = mapImageError(caught);
      setError(mapped.kind === 'error' ? mapped.message : null);
      setState('error');
      return;
    }

    const result = await submitClockEventWithOfflineFallback(
      args.action,
      {
        lat: args.gps.lat,
        lon: args.gps.lon,
        accuracyM: args.gps.accuracyM,
        clientOccurredAt: new Date().toISOString(),
        selfieBase64,
        deviceFingerprint: args.deviceFingerprint ?? undefined,
      },
      { online: args.online }
    );

    if (result.kind === 'submitted_in') {
      setSuccessMessage(
        result.response.insideSite && result.response.siteName
          ? `Clocked in at ${result.response.siteName}.`
          : 'Clocked in. (No site geofence matched — your supervisor has been notified.)'
      );
      setState('success');
    } else if (result.kind === 'submitted_out') {
      setSuccessMessage(`Clocked out. Shift length: ${(result.response.durationMs / 3_600_000).toFixed(1)}h.`);
      setState('success');
    } else if (result.kind === 'queued') {
      setQueuedEventId(result.eventId);
      await args.refreshPendingCount();
      setSuccessMessage(args.action === 'in' ? 'Clock-in saved on this phone.' : 'Clock-out saved on this phone.');
      setState('queued');
    } else if (result.kind === 'consent_required') {
      setState('consent_required');
    } else if (result.kind === 'not_saved') {
      setError(result.message);
      setState('not_saved');
    } else {
      setError(result.message);
      setState('error');
    }
  };

  const grantConsent = async () => {
    setError(null);
    setState('submitting');
    try {
      await grantSelfieConsent();
    } catch (caught) {
      setError(mapConsentError(caught));
      setState('consent_required');
      return;
    }
    await doSubmit();
  };

  return {
    state,
    error,
    successMessage,
    queuedEventId,
    doSubmit,
    grantConsent,
    reset: () => { setError(null); setQueuedEventId(null); setState('idle'); },
    cancelConsent: () => {
      setQueuedEventId(null);
      setState('idle');
      setError('Consent is required to clock in or out.');
    },
  };
}
