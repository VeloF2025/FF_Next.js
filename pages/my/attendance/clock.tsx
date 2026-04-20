/**
 * /my/attendance/clock — selfie + GPS capture + submit.
 *
 * Query: ?action=in | ?action=out (default: in).
 * Flow: take selfie → capture GPS (auto) → review → submit. Error mapping
 * lives in clockErrors.ts so the page stays focused on UI orchestration.
 *
 * Offline queue is NOT in this PR — submit is disabled when navigator.onLine
 * is false. PR5 adds the IndexedDB flush.
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { captureGPS } from '@/modules/fleet/offline/gpsCapture';
import {
  ApiError,
  clockIn,
  clockOut,
  grantSelfieConsent,
  getSession,
} from '@/modules/attendance/portal/client/api';
import { fileToResizedBase64 } from '@/modules/attendance/portal/client/imageUtils';
import { useDeviceFingerprint } from '@/modules/attendance/portal/client/useDeviceFingerprint';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import {
  ConsentModal,
  GpsSnapshot,
  GpsStep,
  SelfieStep,
  SuccessView,
} from '@/modules/attendance/portal/client/clockSteps';
import {
  mapConsentError,
  mapImageError,
  mapSubmitError,
} from '@/modules/attendance/portal/client/clockErrors';

type Action = 'in' | 'out';
type FlowState = 'idle' | 'gps' | 'submitting' | 'consent_required' | 'success' | 'error';

const MyClockPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const deviceFingerprint = useDeviceFingerprint();

  const action: Action = router.query.action === 'out' ? 'out' : 'in';

  const [staffName, setStaffName] = React.useState<string | null>(null);
  const [selfieFile, setSelfieFile] = React.useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = React.useState<string | null>(null);
  const [gps, setGps] = React.useState<GpsSnapshot | null>(null);
  const [state, setState] = React.useState<FlowState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(true);

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
        // 401 → login. Anything else is worth seeing rather than silently
        // punting the user to the login page with no signal.
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setError('Could not verify your session. Please sign in again.');
        setState('error');
      }
    })();
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      cancelled = true;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [router]);

  React.useEffect(() => {
    return () => {
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    };
  }, [selfiePreview]);

  const captureGpsOnce = React.useCallback(async () => {
    // Guard against concurrent calls racing their setState.
    if (gpsInFlight.current) return;
    gpsInFlight.current = true;
    setState('gps');
    try {
      const result = await captureGPS(10_000, true);
      if (result.success && result.coordinates) {
        setGps({
          lat: result.coordinates.latitude,
          lon: result.coordinates.longitude,
          accuracyM: result.coordinates.accuracy,
          capturedAt: new Date(result.coordinates.timestamp).toISOString(),
        });
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

    const shared = {
      lat: gps.lat,
      lon: gps.lon,
      accuracyM: gps.accuracyM,
      clientOccurredAt: new Date().toISOString(),
      selfieBase64,
      deviceFingerprint: deviceFingerprint ?? undefined,
    };

    try {
      if (action === 'in') {
        const result = await clockIn(shared);
        setSuccessMessage(
          result.insideSite && result.siteName
            ? `Clocked in at ${result.siteName}.`
            : 'Clocked in. (No site geofence matched — your supervisor has been notified.)'
        );
      } else {
        const hours = (await clockOut(shared)).durationMs / 3_600_000;
        setSuccessMessage(`Clocked out. Shift length: ${hours.toFixed(1)}h.`);
      }
      setState('success');
    } catch (err) {
      const mapped = mapSubmitError(err, action);
      if (mapped.kind === 'consent_required') { setState('consent_required'); return; }
      setError(mapped.message);
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
  const submitDisabled = !selfieFile || !gps || state === 'submitting' || state === 'gps' || !online;

  return (
    <MyPortalShell
      title={headingLabel}
      staffName={staffName}
      showFooterNav={false}
    >
      <div className="pt-2 pb-3">
        <Link
          href="/my/attendance"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>

      {!online && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-900 mb-3">
          You are offline. Submissions while offline aren&apos;t supported yet —
          please try again once you have signal.
        </div>
      )}

      {state === 'success' ? (
        <SuccessView
          message={successMessage ?? 'Done.'}
          onDone={() => router.push('/my/attendance')}
        />
      ) : state === 'consent_required' ? (
        <ConsentModal
          onGrant={handleGrantConsent}
          onCancel={() => { setState('idle'); setError('Consent is required to clock in or out.'); }}
          submitting={false}
        />
      ) : (
        <>
          <SelfieStep
            selfiePreview={selfiePreview}
            onCapture={() => cameraRef.current?.click()}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={handleSelfieChange}
          />

          <GpsStep
            gps={gps}
            capturing={state === 'gps'}
            onRetry={captureGpsOnce}
          />

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-3">
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
            ) : (
              `Submit ${headingLabel.toLowerCase()}`
            )}
          </button>
        </>
      )}
    </MyPortalShell>
  );
};

MyClockPage.getLayout = (page: React.ReactElement) => page;

export default MyClockPage;
