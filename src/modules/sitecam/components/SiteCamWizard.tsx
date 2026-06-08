import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { useSiteCamCapture, type SiteInfo } from '../hooks/useSiteCamCapture';
import { getStepsForJobType } from '../lib/sitecamSteps';
import type { GeofenceReading } from '../lib/geofence';
import { StepCapture } from './StepCapture';
import { SiteCamSuccess } from './SiteCamSuccess';

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
  const [_appealOpen, setAppealOpen] = useState(false);
  const {
    stepStates,
    currentStep,
    allDone,
    captureAndValidate,
    handleSerialSaved,
    submitAll,
    uploading,
    uploadError,
    uploadResult,
  } = useSiteCamCapture(steps, siteInfo, entryGeofence);

  const total = stepStates.length;
  const doneCount = stepStates.filter(
    (s) => s.status === 'pass' || s.status === 'escalated' || s.status === 'serial_pending',
  ).length;
  const passedCount = stepStates.filter((s) => s.status === 'pass').length;
  const escalatedCount = stepStates.filter((s) => s.status === 'escalated').length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  if (uploadResult) {
    return (
      <MyPortalShell title="SiteCam" staffName={profile.name} showFooterNav={false}>
        <SiteCamSuccess uploadedCount={uploadResult.uploadedCount} />
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

        {/* Current step */}
        {!allDone && currentStep && (
          <StepCapture
            step={currentStep}
            drNumber={siteInfo.siteId}
            onCapture={(f) => void captureAndValidate(f)}
            onSerialSaved={handleSerialSaved}
            onAppeal={() => setAppealOpen(true)}
          />
        )}

        {/* All done — submit */}
        {allDone && !uploadResult && (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-6 space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle className="h-10 w-10 text-green-400" />
              <h2 className="text-lg font-semibold text-neutral-100">All steps complete</h2>
              <p className="text-sm text-neutral-400">
                {passedCount} passed · {escalatedCount} escalated
              </p>
            </div>

            {uploadError && (
              <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {uploadError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void submitAll()}
              disabled={uploading}
              className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 active:bg-sky-700"
            >
              {uploading ? 'Uploading…' : 'Submit All Photos'}
            </button>
          </div>
        )}
      </div>
    </MyPortalShell>
  );
}
