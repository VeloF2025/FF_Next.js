import { Loader2 } from 'lucide-react';
import React from 'react';

import { ConsentModal, GpsStep, SelfieStep } from '../clockSteps';
import { GpsPermissionHelp } from '../GpsPermissionHelp';
import {
  OfflineBanner,
  PendingQueueBanner,
  QueueSyncIssuesBanner,
  QueueUnavailableBanner,
} from '../clockBanners';
import { DrainedQueuedView, NotSavedView, QueuedView, SuccessView } from '../clockResults';
import { useAttendanceSync } from '../offline/useAttendanceSync';
import { useDeviceFingerprint } from '../useDeviceFingerprint';
import { HsCheckinSteps } from './HsCheckinSteps';
import { useClockEvidence } from './useClockEvidence';
import { useClockSubmission } from './useClockSubmission';
import type { ClockAction } from './useClockSubmission';

export function ClockActionFlow({
  action,
  onDone,
}: {
  action: ClockAction;
  onDone: (destination: string) => void;
}) {
  const deviceFingerprint = useDeviceFingerprint();
  const sync = useAttendanceSync();
  const evidence = useClockEvidence();
  const submission = useClockSubmission({
    action,
    selfieFile: evidence.selfieFile,
    gps: evidence.gps,
    deviceFingerprint,
    online: sync.online,
    refreshPendingCount: sync.refreshPendingCount,
  });
  const [hsDone, setHsDone] = React.useState(false);
  const heading = action === 'in' ? 'Clock in' : 'Clock out';
  const disabled = !evidence.selfieFile || !evidence.gps || submission.state === 'submitting' || evidence.capturing;
  const formVisible = submission.state === 'idle' || submission.state === 'submitting' || submission.state === 'error';
  const queueResolved = submission.state === 'queued'
    && submission.queuedEventId
    && sync.pendingCount === 0
    && sync.lastReport;
  const currentQueueFailure = queueResolved
    ? sync.lastReport?.failures.find(({ id }) => id === submission.queuedEventId) ?? null
    : null;
  const unrelatedFailureCount = queueResolved
    ? sync.lastReport?.failures.filter(({ id }) => id !== submission.queuedEventId).length ?? 0
    : 0;
  const queuedSyncSucceeded = Boolean(
    queueResolved && sync.lastReport?.succeeded && !currentQueueFailure
  );

  return (
    <>
      {sync.queueUnavailable && <QueueUnavailableBanner />}
      {!sync.online && <OfflineBanner />}
      {sync.pendingCount > 0 && (
        <PendingQueueBanner
          pendingCount={sync.pendingCount}
          online={sync.online}
          syncing={sync.syncing}
          onSyncNow={() => void sync.syncNow()}
        />
      )}
      {unrelatedFailureCount > 0 && (
        <QueueSyncIssuesBanner failureCount={unrelatedFailureCount} />
      )}
      {submission.state === 'success' && action === 'in' && !hsDone && (
        <HsCheckinSteps
          attendanceEntryId={submission.entryId}
          gps={evidence.gps ? { lat: evidence.gps.lat, lon: evidence.gps.lon } : null}
          onDone={() => setHsDone(true)}
        />
      )}
      {submission.state === 'success' && (action === 'out' || hsDone) && (
        <SuccessView
          message={submission.successMessage ?? 'Done.'}
          onDone={() => onDone(action === 'in' ? '/my' : '/my/attendance')}
        />
      )}
      {submission.state === 'queued' && currentQueueFailure && (
        <DrainedQueuedView
          message={currentQueueFailure.message}
          onDone={() => onDone('/my/attendance')}
        />
      )}
      {submission.state === 'queued' && queuedSyncSucceeded && (
        <SuccessView
          message={`Queued clock-${action} submitted`}
          onDone={() => onDone('/my/attendance')}
        />
      )}
      {submission.state === 'queued' && !currentQueueFailure && !queuedSyncSucceeded && (
        <QueuedView
          message={submission.successMessage ?? 'Saved.'}
          queuePosition={sync.pendingCount}
          onDone={() => onDone('/my/attendance')}
        />
      )}
      {submission.state === 'not_saved' && (
        <NotSavedView message={submission.error ?? 'Not saved.'} onBack={submission.reset} />
      )}
      {submission.state === 'consent_required' && (
        <ConsentModal
          onGrant={submission.grantConsent}
          onCancel={submission.cancelConsent}
          submitting={false}
        />
      )}
      {formVisible && (
        <>
          <SelfieStep
            selfiePreview={evidence.selfiePreview}
            onCapture={() => evidence.cameraRef.current?.click()}
          />
          <input
            ref={evidence.cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={evidence.handleSelfieChange}
          />
          {evidence.gpsDenied ? (
            <GpsPermissionHelp onRetry={evidence.retryDenied} />
          ) : (
            <GpsStep
              gps={evidence.gps}
              capturing={evidence.capturing}
              onRetry={evidence.captureGpsOnce}
              address={evidence.gpsAddress}
            />
          )}
          {(evidence.error || submission.error) && (
            <div role="alert" className="mb-3 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {evidence.error || submission.error}
            </div>
          )}
          <button
            type="button"
            onClick={() => void submission.doSubmit()}
            disabled={disabled}
            className={`w-full touch-manipulation rounded-xl py-4 text-lg font-bold text-white shadow-sm active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50 ${
              action === 'in' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {submission.state === 'submitting' ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Submitting…
              </span>
            ) : `Submit ${heading.toLowerCase()}`}
          </button>
        </>
      )}
    </>
  );
}
