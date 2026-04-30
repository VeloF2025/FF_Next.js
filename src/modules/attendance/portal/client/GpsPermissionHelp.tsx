/**
 * GpsPermissionHelp — platform-aware help banner shown when location has
 * been denied for this site.
 *
 * Why this exists: once a browser records a geolocation deny, the website
 * cannot re-trigger the native prompt. The user must flip the per-site
 * permission back to "ask" or "allow" in their browser's settings. Field
 * staff don't know those paths by memory, so we tell them — with the right
 * steps for whichever browser they're on.
 *
 * Detection uses userAgent sniffing, which is imperfect but good enough
 * for a "here's a recipe" UI. We default to a generic path if we can't
 * confidently match.
 */

import React from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { queryGeolocationPermission } from '@/modules/fleet/offline/gpsCapture';
import { detectPlatform, type Platform } from './gpsPlatform';

interface Step {
  step: string;
}

function stepsFor(platform: Platform): Step[] {
  switch (platform) {
    case 'ios-safari':
      // The FIRST step is the one that actually matters and is the
      // least-obvious: iOS has a system-level Location Services master
      // switch for Safari, separate from the per-site permission in
      // Website Settings. Without this ON, geolocation silently fails
      // even when the Permissions API reports "granted" for the site.
      // Hein hit this on 2026-04-24 — putting it first so field staff
      // don't waste time on the Safari-only toggle.
      return [
        { step: 'iOS Settings → Privacy & Security → Location Services → Safari Websites → set to "While Using the App".' },
        { step: 'Back in Safari: tap the "ⓐA" icon on the left of the address bar.' },
        { step: 'Tap Website Settings → Location → Allow.' },
        { step: 'Tap the button below to reload with a fresh page.' },
        { step: 'Still blocked? iOS Settings → Safari → Advanced → Website Data → swipe-delete any "fibreflow.app" entry, then reopen the site.' },
      ];
    case 'ios-other':
      return [
        { step: 'iOS Settings → Privacy & Security → Location Services → Safari Websites → set to "While Using the App".' },
        { step: 'Reload this page and try clocking in again.' },
      ];
    case 'android-chrome':
      return [
        { step: 'Tap the lock icon (🔒) next to the address bar.' },
        { step: 'Tap Permissions → Location → Allow.' },
        { step: 'Reload this page.' },
      ];
    case 'android-samsung':
      // Samsung Internet labels its per-site permissions menu differently
      // from Chrome and the lock-icon shortcut sometimes only exposes
      // "Cookies and site data" on older versions. The menu path is the
      // reliable route on every Samsung Internet build we've seen.
      return [
        { step: 'Tap the lock icon (🔒) next to the address bar, then tap Permissions → Location → Allow.' },
        { step: 'If that menu is missing: tap ☰ (bottom-right) → Settings → Sites and downloads → Site permissions → Location.' },
        { step: 'Find app.fibreflow.app, set to Allow, then reload this page.' },
        { step: 'Still blocked? Android Settings → Apps → Samsung Internet → Permissions → Location → Allow only while using the app.' },
      ];
    case 'desktop-chrome':
      return [
        { step: 'Click the location icon (📍 or 🚫) on the left of the address bar.' },
        { step: 'Choose "Always allow location access" → reload.' },
      ];
    case 'desktop-safari':
      return [
        { step: 'In the Safari menu bar: Safari → Settings → Websites → Location.' },
        { step: 'Find app.fibreflow.app, set to Allow, then reload.' },
      ];
    case 'desktop-firefox':
      return [
        { step: 'Click the shield/permissions icon left of the address bar.' },
        { step: 'Clear the Location block, reload, then accept the next prompt.' },
      ];
    default:
      return [
        { step: 'Open your browser’s site settings for app.fibreflow.app.' },
        { step: 'Set Location to Allow (or Ask), then reload this page.' },
      ];
  }
}

/**
 * Force a fresh document load that bypasses the tab's in-memory cache.
 *
 * Why this is needed: iOS Safari keeps the loaded document (and the
 * Permissions-Policy header attached to it) in tab memory even after a
 * pull-to-refresh. If the page was originally served with
 * `Permissions-Policy: geolocation=()` (our old policy, pre-#1441),
 * WebKit's stored Permission state for the origin becomes "denied" and
 * per-site toggles don't override it. The only escape is to load a new
 * URL that WebKit hasn't cached — a query-string cache-buster forces a
 * distinct cache key.
 *
 * We use `location.replace` (not `assign`) so we don't pollute history.
 */
function forceFreshReload(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('_cb', Date.now().toString(36));
  window.location.replace(url.toString());
}

export function GpsPermissionHelp({
  onRetry,
}: {
  /** Optional retry handler — the "Try again in page" button. */
  onRetry?: () => void;
}) {
  // Platform detection runs client-side only to avoid an SSR/hydration
  // mismatch on the userAgent string.
  const [platform, setPlatform] = React.useState<Platform>('unknown');
  // Raw Permissions API state — shown in the diagnostic panel so we can
  // debug remotely via screenshots. Without this, a user reporting "still
  // blocked after I set it to Allow" leaves us guessing which layer is
  // stuck.
  const [permState, setPermState] = React.useState<string>('checking…');
  const [showDiag, setShowDiag] = React.useState(false);
  // One-shot guard: auto-retry exactly once when the live permission state
  // becomes 'granted' (e.g. user toggled it in browser settings). We do
  // NOT auto-retry on 'prompt' — getCurrentPosition called from a
  // visibilitychange/PermissionStatus.change handler has no user-gesture
  // context, and iOS Safari requires a user gesture to display the
  // permission prompt. The 'prompt' case is handled by the canRePrompt
  // UI below, which surfaces an "Allow location" button — the user's
  // tap on that button IS a user gesture, so the in-app prompt fires
  // correctly.
  const autoRetriedRef = React.useRef(false);

  // Auto-recovery: when the user toggles permission in browser settings
  // and returns to the tab, we want the banner to clear itself without a
  // manual tap. PermissionStatus dispatches a `change` event when the
  // state transitions, and we also poll on every visibilitychange (user
  // returning from Settings).
  React.useEffect(() => {
    setPlatform(detectPlatform());

    let cancelled = false;
    let statusRef: PermissionStatus | null = null;

    const check = async () => {
      const s = await queryGeolocationPermission();
      if (cancelled) return;
      setPermState(s);
      // Auto-dismiss only when state is actually 'granted' — the user
      // toggled permission in browser settings and returned to the tab.
      // For 'prompt' we let the user tap "Allow location" (user gesture
      // required for iOS Safari to display the prompt). One-shot guard
      // keeps us from looping if PermissionStatus 'change' re-fires.
      if (s === 'granted' && onRetry && !autoRetriedRef.current) {
        autoRetriedRef.current = true;
        onRetry();
      }
    };

    // Wire up live change detection via the Permissions API, if supported.
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (perms && typeof perms.query === 'function') {
      perms
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          if (cancelled) return;
          statusRef = status;
          status.addEventListener('change', check);
        })
        .catch(() => {
          // older browsers — onvisibilitychange below is still a working fallback
        });
    }

    // Fallback: the user coming back to the tab after visiting Settings
    // on iOS often doesn't fire the PermissionStatus change event reliably.
    // Re-check whenever the tab becomes visible.
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);

    void check();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (statusRef) statusRef.removeEventListener('change', check);
    };
  }, [onRetry]);

  const steps = stepsFor(platform);
  // When the Permissions API reports 'prompt', the browser will still
  // show the native prompt on the next getCurrentPosition call. Don't
  // tell the user the site is blocked — guide them to tap "Allow
  // location" instead, which fires the in-app prompt.
  const canRePrompt = permState === 'prompt';

  return (
    <div className="rounded-2xl bg-amber-950/30 border border-amber-800 p-4 my-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-900/50 text-amber-300 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-200">
            {permState === 'granted'
              ? 'Permission granted — refreshing…'
              : canRePrompt
                ? 'We need your location to clock in'
                : 'Location is blocked for this site'}
          </h3>
          <p className="mt-1 text-xs text-amber-300">
            {permState === 'granted'
              ? 'Your browser now reports location access is allowed. Re-trying capture automatically.'
              : canRePrompt
                ? 'Tap "Allow location" below — your browser will ask for permission. Choose Allow (or "While using this site") to continue.'
                : 'We can’t re-ask for permission — the browser won’t let us prompt again once it’s been denied. Allow location for this site, then tap the reload button below.'}
          </p>
          {!canRePrompt && (
            <ol className="mt-3 space-y-1.5 text-xs text-amber-100 list-decimal list-inside">
              {steps.map((s, i) => (
                <li key={i}>{s.step}</li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canRePrompt && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-amber-50 text-sm font-medium px-4 min-h-[48px]"
              >
                <MapPin className="w-4 h-4" />
                Allow location
              </button>
            )}
            {!canRePrompt && (
              <button
                type="button"
                onClick={forceFreshReload}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-amber-50 text-sm font-medium px-4 min-h-[48px]"
              >
                <RefreshCw className="w-4 h-4" />
                Reload with fresh page
              </button>
            )}
            {!canRePrompt && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-700 text-amber-200 hover:bg-amber-900/40 text-sm font-medium px-4 min-h-[48px]"
              >
                Try without reload
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowDiag((v) => !v)}
            className="mt-3 text-[11px] text-amber-400 hover:text-amber-200 underline"
          >
            {showDiag ? 'Hide' : 'Show'} technical details
          </button>
          {showDiag && (
            <pre className="mt-2 text-[10px] text-amber-200 bg-amber-950/60 border border-amber-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {`Permissions API: ${permState}
Platform: ${platform}
UA: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}
Time: ${new Date().toISOString()}`}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
