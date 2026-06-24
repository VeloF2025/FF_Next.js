/**
 * /my/sitecam — SiteCam entry page.
 *
 * Thin session shell: loads the portal session and role-gates to
 * active authenticated portal users.
 * Renders SiteCamEntry once authorised.
 *
 * Session is checked client-side so SSR renders a cacheable loading
 * shell without leaking auth state into cached HTML.
 */

import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { SiteCamEntry } from '@/modules/sitecam/components/SiteCamEntry';
import { getSession } from '@/modules/attendance/portal/client/api';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { isSiteCamAuthorised } from '@/modules/sitecam/lib/sitecamAuth';

// =============================================================================
// Session state
// =============================================================================

type SessionState = 'loading' | 'guest' | 'authorised' | 'unauthorised' | 'error';

// =============================================================================
// Page
// =============================================================================

const SiteCamIndexPage: NextPage & {
  getLayout?: (page: ReactElement) => ReactElement;
} = () => {
  const router = useRouter();
  const [state, setState] = useState<SessionState>('loading');
  const [profile, setProfile] = useState<AttendanceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((res) => {
        if (cancelled) return;
        if (!res.session || !res.profile) {
          setState('guest');
          return;
        }
        setProfile(res.profile);
        setState(
          isSiteCamAuthorised(res.profile.role, res.profile.authRole, res.profile.accountStatus)
            ? 'authorised'
            : 'unauthorised',
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Session check failed');
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <MyPortalShell title="SiteCam" showFooterNav={false}>
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
      <MyPortalShell title="SiteCam" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'error') {
    return (
      <MyPortalShell title="SiteCam" showFooterNav={false}>
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
        title="SiteCam"
        staffName={profile?.name}
        showFooterNav={false}
      >
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            SiteCam is only available to active portal accounts while testing is open.
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

  return <SiteCamEntry profile={profile} />;
};

SiteCamIndexPage.getLayout = (page: ReactElement) => page;

export default SiteCamIndexPage;
