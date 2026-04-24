/**
 * /my/attendance/clock — selfie + GPS + submit, with offline queue fallback.
 * Query: ?action=in | ?action=out (default: in).
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { captureGPSWithFallback, queryGeolocationPermission } from '@/modules/fleet/offline/gpsCapture';
import {
  ApiError,
  grantSelfieConsent,
  getSession,
  getReverseGeocode,
  type GeocodeResult,
} from '@/modules/attendance/portal/client/api';
import { submitClockEventWithOfflineFallback } from '@/modules/attendance/portal/client/offline/submitClockEvent';
import { useAttendanceSync } from '@/modules/attendance/portal/client/offline/useAttendanceSync';
import { fileToResizedBase64 } from '@/modules/attendance/portal/client/imageUtils';
import { useDeviceFingerprint } from '@/modules/attendance/portal/client/useDeviceFingerprint';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { ConsentModal, GpsSnapshot, GpsStep, SelfieStep } from '@/modules/attendance/portal/client/clockSteps';
import { NotSavedView, QueuedView, SuccessView } from '@/modules/attendance/portal/client/clockResults';
import { OfflineBanner, PendingQueueBanner, QueueUnavailableBanner } from '@/modules/attendance/portal/client/clockBanners';
import { mapConsentError, mapImageError } from '@/modules/attendance/portal/client/clockErrors';
import { GpsPermissionHelp } from '@/modules/attendance/portal/client/GpsPermissionHelp';

type Action = 'in' | 'out';
type FlowState =
  | 'idle'
  | 'gps'
  | 'submitting'
  | 'consent_required'
  | 'success'
  | 'queued'
  | 'not_saved'
  | 'error';

const MyClockPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const deviceFingerprint = useDeviceFingerprint();

  const action: Action = router.query.action === 'out' ? 'out' : 'in';

  const [staffName, setStaffName] = React.useState<string | null>(null);
  const [selfieFile, setSelfieFile] = React.useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = React.useState<string | null>(null);
  const [gps, setGps] = React.useState<GpsSnapshot | null>(null);
  // Resolved human-readable address for the current gps fix, e.g.
  // "Somerset West, Western Cape". Purely informational — null while the
  // lookup is pending OR failed. Clock-in submit never waits on this.
  const [gpsAddress, setGpsAddress] = React.useState<string | null>(null);
  const [state, setState] = React.useState<FlowState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  // True when the browser has a persistent "deny" for geolocation on this
  // origin. Set either by the Permissions API check on mount (iOS 16+,
  // Chrome, Firefox) or by a live PERMISSION_DENIED from getCurrentPosition.
  // When true, we don't hit getCurrentPosition (iOS Safari silently hangs
  // in that state); we render GpsPermissionHelp instead.
  const [gpsDenied, setGpsDenied] = React.useState(false);

  const { online, pendingCount, syncing, queueUnavailable, syncNow, refreshPendingCount } =
    useAttendanceSync();
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const gpsInFlight = React.useRef(false);

  // Session + online status on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess.session) {
          await router.replace('/my');
          return;
        }
        setStaffName(sess.profile?.name ?? null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setError('Could not verify your session. Please sign in again.');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  React.useEffect(() => () => {
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
  }, [selfiePreview]);

  // Preflight the geolocation permission so that if the browser has a
  // stored deny for this origin, we render the help banner instead of
  // calling getCurrentPosition (which on iOS Safari just hangs forever
  // without firing the error callback).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await queryGeolocationPermission();
      if (cancelled) return;
      if (state === 'denied') setGpsDenied(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Reverse-geocode the captured gps fix so the user sees a readable
  // "Somerset West, Western Cape" under the raw coordinates. Fire-and-
  // forget — never blocks submit. Clears on new capture so an old
  // address from an earlier fix doesn't linger next to new coords.
  React.useEffect(() => {
    if (!gps) { setGpsAddress(null); return; }
    let cancelled = false;
    (async () => {
      const result: GeocodeResult | null = await getReverseGeocode(gps.lat, gps.lon);
      if (cancelled || !result) return;
      setGpsAddress(formatGeocode(result));
    })();
    return () => { cancelled = true; };
  }, [gps]);

  const captureGpsOnce = React.useCallback(async () => {
    if (gpsInFlight.current) return;
    gpsInFlight.current = true;
    setState('gps');
    try {
      // High-accuracy first with a 10s budget, then auto-fall-back to
      // network/wifi-based low-accuracy with 15s. Indoor clock-ins where
      // the GPS chip can't get a fix previously stuck on the spinner —
      // the fallback lets the browser use cell-tower / wifi triangulation
      // instead. Accuracy may widen to ~50-500m; the summary-view banner
      // in GpsStep already flags "Low accuracy" when the radius > 100m.
      const result = await captureGPSWithFallback(10_000, 15_000);
      if (result.success && result.coordinates) {
        setGpsDenied(false);
        setGps({
          lat: result.coordinates.latitude,
          lon: result.coordinates.longitude,
          accuracyM: result.coordinates.accuracy,
          capturedAt: new Date(result.coordinates.timestamp).toISOString(),
        });
        setState('idle');
      } else if (result.errorKind === 'denied') {
        // Don't treat a deny as a general error — surface the platform-
        // specific help instead so the user knows how to unstick it.
        setGpsDenied(true);
        setState('idle');
      } else {
        setState('error');
        setError(result.error ?? 'Could not capture location. Check GPS permission.');
      }
    } finally {
      gpsInFlight.current = false;
    }
  }, []);

  const handleSelfieChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (!file) {
      // User cancelled the camera sheet. Keep existing selfie (if any).
      return;
    }
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfieFile(file);
    setSelfiePreview(URL.createObjectURL(file));
    void captureGpsOnce();
  };

  const doSubmit = async (): Promise<void> => {
    if (!selfieFile) {
      setError('Take a selfie first.');
      setState('error');
      return;
    }
    if (!gps) {
      setError('Waiting for GPS. Tap "Get location" below.');
      setState('error');
      return;
    }
    setError(null);
    setState('submitting');

    let selfieBase64: string;
    try {
      selfieBase64 = await fileToResizedBase64(selfieFile);
    } catch (err) {
      const mapped = mapImageError(err);
      setError(mapped.kind === 'error' ? mapped.message : null);
      setState('error');
      return;
    }

    const result = await submitClockEventWithOfflineFallback(
      action,
      {
        lat: gps.lat,
        lon: gps.lon,
        accuracyM: gps.accuracyM,
        clientOccurredAt: new Date().toISOString(),
        selfieBase64,
        deviceFingerprint: deviceFingerprint ?? undefined,
      },
      { online }
    );

    switch (result.kind) {
      case 'submitted_in': {
        const r = result.response;
        setSuccessMessage(
          r.insideSite && r.siteName
            ? `Clocked in at ${r.siteName}.`
            : 'Clocked in. (No site geofence matched — your supervisor has been notified.)'
        );
        setState('success');
        return;
      }
      case 'submitted_out': {
        const hours = result.response.durationMs / 3_600_000;
        setSuccessMessage(`Clocked out. Shift length: ${hours.toFixed(1)}h.`);
        setState('success');
        return;
      }
      case 'queued':
        await refreshPendingCount();
        setSuccessMessage(
          action === 'in'
            ? 'Clock-in saved on this phone.'
            : 'Clock-out saved on this phone.'
        );
        setState('queued');
        return;
      case 'consent_required':
        setState('consent_required');
        return;
      case 'not_saved':
        setError(result.message);
        setState('not_saved');
        return;
      case 'error':
        setError(result.message);
        setState('error');
    }
  };

  const handleGrantConsent = async () => {
    setError(null);
    setState('submitting');
    try {
      await grantSelfieConsent();
    } catch (err) {
      setError(mapConsentError(err));
      setState('consent_required');
      return;
    }
    // Consent saved. Retry the clock submission — its own error paths now
    // run cleanly without the consent-grant catch mislabelling them.
    await doSubmit();
  };

  const headingLabel = action === 'in' ? 'Clock in' : 'Clock out';
  const submitDisabled = !selfieFile || !gps || state === 'submitting' || state === 'gps';

  return (
    <MyPortalShell title={headingLabel} staffName={staffName} showFooterNav={false}>
      <div className="pt-2 pb-3">
        <Link href="/my/attendance" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>

      {queueUnavailable && <QueueUnavailableBanner />}
      {!online && <OfflineBanner />}

      {pendingCount > 0 && (
        <PendingQueueBanner
          pendingCount={pendingCount}
          online={online}
          syncing={syncing}
          onSyncNow={() => void syncNow()}
        />
      )}

      {state === 'success' && (
        <SuccessView message={successMessage ?? 'Done.'} onDone={() => router.push('/my/attendance')} />
      )}
      {state === 'queued' && (
        <QueuedView
          message={successMessage ?? 'Saved.'}
          queuePosition={pendingCount}
          onDone={() => router.push('/my/attendance')}
        />
      )}
      {state === 'not_saved' && (
        <NotSavedView message={error ?? 'Not saved.'} onBack={() => { setError(null); setState('idle'); }} />
      )}
      {state === 'consent_required' && (
        <ConsentModal
          onGrant={handleGrantConsent}
          onCancel={() => { setState('idle'); setError('Consent is required to clock in or out.'); }}
          submitting={false}
        />
      )}
      {(state === 'idle' || state === 'gps' || state === 'submitting' || state === 'error') && (
        <>
          <SelfieStep selfiePreview={selfiePreview} onCapture={() => cameraRef.current?.click()} />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={handleSelfieChange}
          />
          {gpsDenied ? (
            <GpsPermissionHelp onRetry={() => { setGpsDenied(false); void captureGpsOnce(); }} />
          ) : (
            <GpsStep
              gps={gps}
              capturing={state === 'gps'}
              onRetry={captureGpsOnce}
              address={gpsAddress}
            />
          )}
          {error && (
            <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200 mb-3">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={doSubmit}
            disabled={submitDisabled}
            className={`w-full py-4 rounded-xl text-white text-lg font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              action === 'in' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {state === 'submitting' ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting…
              </span>
            ) : `Submit ${headingLabel.toLowerCase()}`}
          </button>
        </>
      )}
    </MyPortalShell>
  );
};

/**
 * Format the Nominatim proxy result into a compact one-liner for
 * display under the raw coordinates. Preferred form is
 * "<city>, <province>" (e.g. "Somerset West, Western Cape"); falls
 * back to province-only if the geocoder returned its "Unknown City"
 * sentinel; returns empty string if neither field is usable, which
 * makes the caller hide the line.
 */
function formatGeocode(r: GeocodeResult): string {
  const cityRaw = r.city?.trim() ?? '';
  const provinceRaw = r.province?.trim() ?? '';
  const city = cityRaw && cityRaw !== 'Unknown City' ? cityRaw : '';
  const province = provinceRaw;
  if (city && province) return `${city}, ${province}`;
  return city || province || '';
}

MyClockPage.getLayout = (page: React.ReactElement) => page;

export default MyClockPage;
