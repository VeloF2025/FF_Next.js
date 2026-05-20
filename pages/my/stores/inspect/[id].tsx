/**
 * /my/stores/inspect/[id] — single return disposition screen (thin session shell).
 *
 * Gated to isReturnInspector. Gets returnId from router.query.id.
 * Delegates rendering to InspectOrchestrator once authorised.
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { InspectOrchestrator } from '@/modules/field-stock-pwa/components/InspectOrchestrator';
import { useStoresSession } from '@/modules/field-stock-pwa/hooks/useStoresSession';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';

// =============================================================================
// Page
// =============================================================================

const StoresInspectDetailPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const { state, profile, error } = useStoresSession();

  const returnId = typeof router.query.id === 'string' ? router.query.id : null;

  if (state === 'loading') {
    return (
      <MyPortalShell title="Inspect return" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'guest') {
    if (typeof window !== 'undefined') void router.replace('/my');
    return (
      <MyPortalShell title="Inspect return" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'error') {
    return (
      <MyPortalShell title="Inspect return" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error ?? 'Session check failed'}</span>
        </div>
      </MyPortalShell>
    );
  }

  if (!profile || !isReturnInspector(profile.role, profile.authRole)) {
    return (
      <MyPortalShell
        title="Inspect return"
        staffName={profile?.name}
        showFooterNav={false}
      >
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            The inspection screen is only available to stores staff and administrators.
          </p>
          <button
            type="button"
            onClick={() => void router.push('/my')}
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to hub
          </button>
        </div>
      </MyPortalShell>
    );
  }

  if (!returnId) {
    return (
      <MyPortalShell title="Inspect return" staffName={profile.name} showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Missing return ID</span>
        </div>
      </MyPortalShell>
    );
  }

  return <InspectOrchestrator profile={profile} returnId={returnId} />;
};

StoresInspectDetailPage.getLayout = (page: React.ReactElement) => page;

export default StoresInspectDetailPage;
