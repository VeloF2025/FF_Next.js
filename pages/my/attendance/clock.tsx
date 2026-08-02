import React from 'react';
import type { NextPage } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

import { AttendanceRequiredActionCard } from '@/modules/attendance/portal/client/AttendanceRequiredActionCard';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { AttendanceScheduleCard } from '@/modules/attendance/portal/client/clock/AttendanceScheduleCard';
import { ClockActionFlow } from '@/modules/attendance/portal/client/clock/ClockActionFlow';
import { useClockPageData } from '@/modules/attendance/portal/client/clock/useClockPageData';
import type { ClockAction } from '@/modules/attendance/portal/client/clock/useClockSubmission';

const MyClockPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const action: ClockAction = router.query.action === 'out' ? 'out' : 'in';
  const heading = action === 'in' ? 'Clock in' : 'Clock out';
  const data = useClockPageData(router);
  const session = data.session.status === 'ready' ? data.session.data : null;
  const attendance = data.attendance.status === 'ready' ? data.attendance.data : null;
  const requiredAction = attendance?.requiredAttendanceAction ?? null;
  const ready = Boolean(session && attendance);

  return (
    <MyPortalShell
      title={heading}
      staffName={session?.profile?.name ?? null}
      staffPhotoUrl={session?.profile?.profilePhotoUrl ?? null}
      showFooterNav={false}
    >
      <div className="pb-3 pt-2">
        <Link
          href="/my/attendance"
          className="inline-flex touch-manipulation items-center gap-1 text-sm text-blue-400 hover:text-blue-300 active:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      {data.session.status === 'error' && (
        <LoadFailure message={data.session.error} onRetry={data.retry} />
      )}
      {data.session.status !== 'error' && data.attendance.status === 'error' && (
        <LoadFailure
          message={data.attendance.error}
          onRetry={data.retry}
          label="Retry attendance"
          ariaLabel="Schedule unavailable"
        />
      )}
      {(data.session.status === 'loading' || data.attendance.status === 'loading') && (
        <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Loading schedule…
        </div>
      )}

      {ready && attendance && <AttendanceScheduleCard attendance={attendance} />}
      {ready && requiredAction && (
        <AttendanceRequiredActionCard
          action={requiredAction}
          onCorrect={() => router.push(
            `/my/attendance/corrections/new?entry_id=${encodeURIComponent(requiredAction.entryId)}` +
            `&exception_id=${encodeURIComponent(requiredAction.exceptionId)}`
          )}
        />
      )}
      {ready && !requiredAction && (
        <ClockActionFlow action={action} onDone={(destination) => void router.push(destination)} />
      )}
    </MyPortalShell>
  );
};

function LoadFailure({
  message,
  onRetry,
  label = 'Retry',
  ariaLabel,
}: {
  message: string;
  onRetry: () => void;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="alert"
      aria-label={ariaLabel}
      className="mb-4 rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 touch-manipulation rounded-lg bg-red-800 px-3 py-2 font-semibold text-white active:bg-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        {label}
      </button>
    </div>
  );
}

MyClockPage.getLayout = (page: React.ReactElement) => page;

export default MyClockPage;
