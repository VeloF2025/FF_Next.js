/**
 * /my/stores — stores PWA landing page.
 *
 * Thin session shell: delegates session loading + role gating to
 * useStoresSession(). Renders StoresHub once authorised.
 *
 * Access-gated to STORES_ROLES (see storesRoles.ts). All other roles see a
 * "Not authorised" screen with a back link.
 *
 * Session is checked client-side so SSR renders a cacheable loading shell
 * without leaking auth state into cached HTML.
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { StoresHub } from '@/modules/field-stock-pwa/components/StoresHub';
import { useStoresSession } from '@/modules/field-stock-pwa/hooks/useStoresSession';

// =============================================================================
// Page
// =============================================================================

const StoresIndexPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const { state, profile, error } = useStoresSession();

  if (state === 'loading') {
    return (
      <MyPortalShell title="Stores" showFooterNav={false}>
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
      <MyPortalShell title="Stores" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'error') {
    return (
      <MyPortalShell title="Stores" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error ?? 'Session check failed'}</span>
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'unauthorised' || !profile) {
    return (
      <MyPortalShell
        title="Stores"
        staffName={profile?.name}
        showFooterNav={false}
      >
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            The stores section is only available to stores staff and administrators.
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

  return (
    <StoresHub
      profile={profile}
      onIssue={() => void router.push('/my/stores/issue')}
      onReturn={() => void router.push('/my/stores/return')}
      onInspect={() => void router.push('/my/stores/inspect')}
      onToday={() => void router.push('/my/stores/today')}
    />
  );
};

StoresIndexPage.getLayout = (page: React.ReactElement) => page;

export default StoresIndexPage;
