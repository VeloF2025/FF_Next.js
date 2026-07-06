/**
 * /my/sitecam/[siteId] — SiteCam wizard page for a specific site.
 *
 * Thin session shell: loads the portal session and fetches the site
 * info from GET /api/sitecam/site/:siteId to confirm the site exists
 * and determine job type.
 *
 * Session is checked client-side so SSR renders a cacheable loading
 * shell without leaking auth state into cached HTML.
 *
 * Warm-start offline restore (Task 7): if the site-info fetch fails (e.g. no
 * connectivity) but a durable job already exists in IndexedDB for this
 * siteId (opened online earlier in this same warm session), the wizard
 * renders from the restored SiteInfo instead of the "Site not found" error —
 * no network fetch required. Cold-start (first-ever open with zero prior
 * connectivity) is out of scope (spec §2 non-goal).
 */

import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { SiteCamWizard } from '@/modules/sitecam/components/SiteCamWizard';
import { getSession } from '@/modules/attendance/portal/client/api';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { isSiteCamAuthorised } from '@/modules/sitecam/lib/sitecamAuth';
import type { SiteInfo } from '@/modules/sitecam/hooks/useSiteCamCapture';
import { decodeGeofenceParam } from '@/modules/sitecam/lib/geofence';
import { findRestorableSiteCamJob } from '@/modules/sitecam/offline/findRestorableSiteCamJob';
import { log } from '@/lib/logger';

const MODULE = 'SiteCamWizardPage';

// =============================================================================
// Page
// =============================================================================

const SiteCamWizardPage: NextPage & {
  getLayout?: (page: ReactElement) => ReactElement;
} = () => {
  const router = useRouter();
  const { siteId } = router.query;

  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<AttendanceProfile | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isUnauthorised, setIsUnauthorised] = useState(false);

  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);

  // Warm-start restore: only consulted once the site-info fetch has failed.
  const [restoredSiteInfo, setRestoredSiteInfo] = useState<SiteInfo | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);

  // Load session once on mount
  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((res) => {
        if (cancelled) return;
        if (!res.session || !res.profile) {
          setIsGuest(true);
          return;
        }
        // Gate the wizard deep-link just like the entry page — pending accounts
        // must not reach the capture/submit flow by navigating straight to
        // /my/sitecam/:id.
        if (!isSiteCamAuthorised(res.profile.role, res.profile.authRole, res.profile.accountStatus)) {
          setProfile(res.profile);
          setIsUnauthorised(true);
          return;
        }
        setProfile(res.profile);
        setSessionReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSessionError(err instanceof Error ? err.message : 'Session check failed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch site info once both router and session are ready
  useEffect(() => {
    if (!sessionReady || !siteId || typeof siteId !== 'string') return;

    let cancelled = false;

    fetch(`/api/sitecam/site/${encodeURIComponent(siteId)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setSiteError(body?.error ?? `Site not found (${res.status})`);
          return;
        }
        // API wraps payloads in apiResponse.success → { success, data }.
        const json = await res.json() as { data: SiteInfo };
        if (!cancelled) setSiteInfo(json.data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSiteError(err instanceof Error ? err.message : 'Could not load site');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionReady, siteId]);

  // Warm-start restore: once the site fetch has failed, check IndexedDB for a
  // job already opened earlier in this session (no network needed). Scoped to
  // the CURRENT staff member (`profile.staffId`) — by the time `siteError` is
  // set, the session-load effect has already resolved successfully (that's
  // the only path to `sessionReady`/site-fetch even starting), so `profile`
  // is guaranteed non-null here; the `!profile` guard is defensive typing only.
  useEffect(() => {
    if (!siteError || typeof siteId !== 'string' || !profile) return;

    let cancelled = false;
    findRestorableSiteCamJob(profile.staffId, siteId)
      .then((found) => {
        if (!cancelled) setRestoredSiteInfo(found?.siteInfo ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          log.warn('SiteCam warm-start restore lookup failed', { siteId, err: String(err) }, MODULE);
          setRestoredSiteInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRestoreChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [siteError, siteId, profile]);

  // Guest redirect
  if (isGuest) {
    if (typeof window !== 'undefined') void router.replace('/my');
    return (
      <MyPortalShell title="SiteCam" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  // Authenticated but blocked by SiteCam account policy
  if (isUnauthorised) {
    return (
      <MyPortalShell title="SiteCam" staffName={profile?.name} showFooterNav={false}>
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            SiteCam is only available to technicians, supervisors, and administrators.
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

  // Session error
  if (sessionError) {
    return (
      <MyPortalShell title="SiteCam" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{sessionError}</span>
        </div>
      </MyPortalShell>
    );
  }

  const entryGeofence = decodeGeofenceParam(router.query.gf);

  // Loading — waiting for session or site info
  if (!sessionReady || !siteInfo) {
    // Site fetch failed — try the warm-start IDB restore before giving up.
    if (siteError) {
      if (!restoreChecked) {
        return (
          <MyPortalShell title="SiteCam" showFooterNav={false}>
            <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          </MyPortalShell>
        );
      }

      if (restoredSiteInfo) {
        return <SiteCamWizard profile={profile!} siteInfo={restoredSiteInfo} entryGeofence={entryGeofence} />;
      }

      return (
        <MyPortalShell title="SiteCam" staffName={profile?.name} showFooterNav={false}>
          <div className="flex flex-col items-center gap-4 pt-16 text-center">
            <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-neutral-200">Site not found</h1>
            <p className="text-sm text-neutral-400 max-w-xs">{siteError}</p>
            <button
              type="button"
              onClick={() => void router.push('/my/sitecam')}
              className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to SiteCam
            </button>
          </div>
        </MyPortalShell>
      );
    }

    return (
      <MyPortalShell title="SiteCam" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </MyPortalShell>
    );
  }

  return <SiteCamWizard profile={profile!} siteInfo={siteInfo} entryGeofence={entryGeofence} />;
};

SiteCamWizardPage.getLayout = (page: ReactElement) => page;

export default SiteCamWizardPage;
