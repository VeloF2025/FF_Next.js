import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { CorrectionForm } from '@/modules/attendance/portal/client/correction/CorrectionForm';
import { RequiredCorrectionSuccess } from '@/modules/attendance/portal/client/correction/RequiredCorrectionSuccess';
import { useCorrectionForm } from '@/modules/attendance/portal/client/correction/useCorrectionForm';
import { useCorrectionPageData } from '@/modules/attendance/portal/client/correction/useCorrectionPageData';
import { linkAttendanceCorrection } from '@/modules/fleet/incidents/driver/web/AttendanceCorrectionLink';
import { pendingCorrectionStorageKey } from '@/modules/fleet/incidents/driver/web/driverPortalLabels';

// `incident_id` is optional Fleet context (design §8): safe to parse from the
// URL because it is only ever a Fleet incident id, never staff identity or
// mutable incident state — a malformed value is simply treated as absent.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LinkStatus = 'idle' | 'linking' | 'linked' | 'failed';

const NewCorrectionPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const requestedEntryId = typeof router.query.entry_id === 'string' ? router.query.entry_id : '';
  const exceptionId = typeof router.query.exception_id === 'string' ? router.query.exception_id : '';
  const rawIncidentId = typeof router.query.incident_id === 'string' ? router.query.incident_id : '';
  const incidentId = UUID_REGEX.test(rawIncidentId) ? rawIncidentId : '';
  const data = useCorrectionPageData(router, requestedEntryId, exceptionId);
  const entryId = data.entryId;

  const [linkStatus, setLinkStatus] = React.useState<LinkStatus>('idle');
  const [pendingAdjustmentId, setPendingAdjustmentId] = React.useState<string | null>(null);

  const attemptLink = React.useCallback(async (adjustmentId: string) => {
    if (!incidentId) return;
    setPendingAdjustmentId(adjustmentId);
    setLinkStatus('linking');
    try {
      await linkAttendanceCorrection(incidentId, adjustmentId);
      setLinkStatus('linked');
      // Clears any stale flag from an earlier failed attempt for this
      // incident — see the write below for why this exists at all.
      try { window.localStorage.removeItem(pendingCorrectionStorageKey(incidentId)); } catch { /* best-effort */ }
    } catch {
      setLinkStatus('failed');
      // Closes a real gap: the "Retry link" button below only lives in
      // this page's own React state, so a driver who navigates away
      // before retrying previously had no way back to it at all. Record
      // the correction id the incident detail page (Task 7) can read on
      // its own — durable across navigation, and even closing the app,
      // unlike this component's state. Best-effort: private-mode/storage
      // failures here must never mask the Attendance success message.
      try { window.localStorage.setItem(pendingCorrectionStorageKey(incidentId), adjustmentId); } catch { /* best-effort */ }
    }
  }, [incidentId]);

  const form = useCorrectionForm({
    entryId,
    exceptionId,
    hints: data.hints,
    onGenericSuccess: () => router.replace('/my/attendance/corrections?from=submit'),
    onRequiredSuccess: incidentId ? attemptLink : undefined,
  });

  return (
    <MyPortalShell
      title="New correction"
      staffName={data.session?.profile?.name ?? null}
      staffPhotoUrl={data.session?.profile?.profilePhotoUrl ?? null}
    >
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 inline-flex touch-manipulation items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200 active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {data.loadError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {data.loadError}
        </div>
      )}
      {!entryId && !exceptionId && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          Missing <code className="font-mono">entry_id</code>. Open the correction form from your history screen.
        </div>
      )}
      {!data.session && !data.loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-neutral-400">Loading…</div>
      )}
      {form.confirmed && <RequiredCorrectionSuccess />}
      {form.confirmed && incidentId && linkStatus !== 'idle' && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm">
          {linkStatus === 'linking' && <p className="text-neutral-400">Linking to the Fleet incident…</p>}
          {linkStatus === 'linked' && <p className="text-emerald-300">Linked to the Fleet incident.</p>}
          {linkStatus === 'failed' && (
            <div role="alert" className="space-y-2 text-amber-200">
              <p>
                Your attendance correction was submitted successfully, but it could not be linked to the
                Fleet incident. You can retry the link.
              </p>
              <button
                type="button"
                onClick={() => pendingAdjustmentId && attemptLink(pendingAdjustmentId)}
                className="touch-manipulation rounded-lg border border-amber-700 px-3 py-1.5 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Retry link
              </button>
            </div>
          )}
        </div>
      )}
      {data.session && entryId && !form.confirmed && (
        <CorrectionForm entry={data.entry} entryId={entryId} hints={data.hints} form={form} />
      )}
    </MyPortalShell>
  );
};

NewCorrectionPage.getLayout = (page: React.ReactElement) => page;

export default NewCorrectionPage;
