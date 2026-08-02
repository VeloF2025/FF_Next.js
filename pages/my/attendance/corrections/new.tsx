import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { CorrectionForm } from '@/modules/attendance/portal/client/correction/CorrectionForm';
import { RequiredCorrectionSuccess } from '@/modules/attendance/portal/client/correction/RequiredCorrectionSuccess';
import { useCorrectionForm } from '@/modules/attendance/portal/client/correction/useCorrectionForm';
import { useCorrectionPageData } from '@/modules/attendance/portal/client/correction/useCorrectionPageData';

const NewCorrectionPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const requestedEntryId = typeof router.query.entry_id === 'string' ? router.query.entry_id : '';
  const exceptionId = typeof router.query.exception_id === 'string' ? router.query.exception_id : '';
  const data = useCorrectionPageData(router, requestedEntryId, exceptionId);
  const entryId = data.entryId;
  const form = useCorrectionForm({
    entryId,
    exceptionId,
    hints: data.hints,
    onGenericSuccess: () => router.replace('/my/attendance/corrections?from=submit'),
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
      {data.session && entryId && !form.confirmed && (
        <CorrectionForm entry={data.entry} entryId={entryId} hints={data.hints} form={form} />
      )}
    </MyPortalShell>
  );
};

NewCorrectionPage.getLayout = (page: React.ReactElement) => page;

export default NewCorrectionPage;
