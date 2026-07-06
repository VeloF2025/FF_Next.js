import { useState } from 'react';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { useSiteCamCapture, type SiteInfo } from '../hooks/useSiteCamCapture';
import { getStepsForJobType } from '../lib/sitecamSteps';
import type { GeofenceReading } from '../lib/geofence';
import { StepCapture } from './StepCapture';
import { saveAllPhotosToDevice, stepPhotoFilename } from '../lib/savePhotoToDevice';
import { SiteCamSuccess } from './SiteCamSuccess';
import { SiteCamOfflineStatus } from './SiteCamOfflineStatus';
import { SiteCamSubmitPanel } from './SiteCamSubmitPanel';
import { PhotoNotSavedBanner } from './PhotoNotSavedBanner';
import { AppealModal } from './AppealModal';
import { log } from '@/lib/logger';

interface Props {
  profile: AttendanceProfile;
  siteInfo: SiteInfo;
  entryGeofence?: GeofenceReading | null;
}

const STATUS_DOT: Record<string, string> = {
  pass: 'bg-green-500',
  escalated: 'bg-amber-500',
  fail: 'bg-red-500',
  validating: 'bg-sky-500 animate-pulse',
  pending: 'bg-neutral-600',
};

export function SiteCamWizard({ profile, siteInfo, entryGeofence = null }: Props) {
  const steps = getStepsForJobType(siteInfo.jobType);
  const [appealOpen, setAppealOpen] = useState(false);
  const {
    stepStates,
    currentStep,
    allDone,
    captureAndValidate,
    handleSerialSaved,
    skipSerialStep,
    submitAll,
    uploading,
    uploadError,
    uploadResult,
    photoNotSaved,
    queued,
    flushing,
    retrySubmit,
    onAppealSubmitted,
    appealPending,
  } = useSiteCamCapture(steps, profile.staffId, siteInfo, entryGeofence);

  const total = stepStates.length;
  const doneCount = stepStates.filter(
    (s) => s.status === 'pass' || s.status === 'escalated' || s.status === 'serial_pending',
  ).length;
  const passedCount = stepStates.filter((s) => s.status === 'pass').length;
  const escalatedCount = stepStates.filter((s) => s.status === 'escalated').length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // A real "Submitted ✓" only ever follows a confirmed 2xx — checked first so
  // it always wins once it lands.
  if (uploadResult) {
    return (
      <MyPortalShell title="SiteCam" staffName={profile.name} showFooterNav={false}>
        <SiteCamSuccess uploadedCount={uploadResult.uploadedCount} />
      </MyPortalShell>
    );
  }

  // A queued-but-not-yet-confirmed submission renders its own screen —
  // NEVER the green success screen (D6 — never green until flushed).
  if (queued) {
    return (
      <MyPortalShell title="SiteCam" staffName={profile.name} showFooterNav={false}>
        <SiteCamOfflineStatus
          photoCount={doneCount}
          uploadError={uploadError}
          flushing={flushing}
          onRetry={() => void retrySubmit()}
        />
      </MyPortalShell>
    );
  }

  return (
    <MyPortalShell title="SiteCam" staffName={profile.name} showFooterNav={false}>
      <div className="space-y-6 pt-2">
        {/* Progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
            <span>
              {doneCount} of {total} steps
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Step dots */}
        <div className="flex flex-wrap gap-2">
          {stepStates.map((s) => (
            <div
              key={s.stepNumber}
              title={s.label}
              className={`h-3 w-3 rounded-full ${
                currentStep?.stepNumber === s.stepNumber && s.status === 'pending'
                  ? 'bg-sky-500'
                  : STATUS_DOT[s.status] ?? 'bg-neutral-600'
              }`}
            />
          ))}
        </div>

        <PhotoNotSavedBanner show={photoNotSaved} />

        {/* Current step */}
        {!allDone && currentStep && (
          <StepCapture
            step={currentStep}
            drNumber={siteInfo.siteId}
            // Read the upload permission from the canonical step config (not the
            // restored draft) so it survives a mid-job deploy that changed it.
            allowUpload={
              steps.find((s) => s.number === currentStep.stepNumber)?.allowUpload ?? false
            }
            onCapture={(f) => void captureAndValidate(f)}
            onSerialSaved={handleSerialSaved}
            onSkipSerial={skipSerialStep}
            onAppeal={() => setAppealOpen(true)}
            appealPending={appealPending}
          />
        )}

        {/* Appeal modal */}
        {currentStep && (
          <AppealModal
            isOpen={appealOpen}
            onClose={() => setAppealOpen(false)}
            onSubmitted={(appealId) => {
              setAppealOpen(false);
              onAppealSubmitted();
              log.info('Appeal submitted', { appealId }, 'SiteCamWizard');
            }}
            drNumber={siteInfo.siteId}
            jobType={siteInfo.jobType}
            stepNumber={currentStep.stepNumber}
            stepLabel={currentStep.label}
            photoUrl={currentStep.photoBase64}
            serialScanned={currentStep.serialScanned ?? undefined}
            attemptNumber={
              currentStep.status === 'serial_scan' || currentStep.status === 'serial_pending'
                ? currentStep.serialAttempts
                : currentStep.attemptNumber
            }
          />
        )}

        {/* All done — submit */}
        {allDone && (
          <SiteCamSubmitPanel
            passedCount={passedCount}
            escalatedCount={escalatedCount}
            uploadError={uploadError}
            uploading={uploading}
            onSubmit={() => void submitAll()}
            onSaveAll={() => {
              void saveAllPhotosToDevice(
                stepStates
                  .filter((s) => s.photoBase64 !== null)
                  .map((s) => ({
                    base64: s.photoBase64 as string,
                    filename: stepPhotoFilename(siteInfo.siteId, s.stepNumber),
                  })),
              ).catch((err: unknown) => {
                log.warn('Save all photos failed', { err: String(err) }, 'SiteCamWizard');
              });
            }}
          />
        )}
      </div>
    </MyPortalShell>
  );
}
