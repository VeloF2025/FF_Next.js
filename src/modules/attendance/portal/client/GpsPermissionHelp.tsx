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

type Platform = 'ios-safari' | 'ios-other' | 'android-chrome' | 'desktop-chrome' | 'desktop-safari' | 'desktop-firefox' | 'unknown';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  const isChrome = /Chrome/.test(ua) || /CriOS/.test(ua);
  const isFirefox = /Firefox/.test(ua) || /FxiOS/.test(ua);

  if (isIos && isSafari) return 'ios-safari';
  if (isIos) return 'ios-other';
  if (isAndroid && isChrome) return 'android-chrome';
  if (isChrome) return 'desktop-chrome';
  if (isSafari) return 'desktop-safari';
  if (isFirefox) return 'desktop-firefox';
  return 'unknown';
}

interface Step {
  step: string;
}

function stepsFor(platform: Platform): Step[] {
  switch (platform) {
    case 'ios-safari':
      return [
        { step: 'Tap the "ⓐA" icon on the left of the address bar.' },
        { step: 'Tap Website Settings.' },
        { step: 'Set Location to Allow, then close and reload this page.' },
      ];
    case 'ios-other':
      return [
        { step: 'Open iOS Settings → Safari → Location → set to Ask.' },
        { step: 'Reload this page and try clocking in again.' },
      ];
    case 'android-chrome':
      return [
        { step: 'Tap the lock icon (🔒) next to the address bar.' },
        { step: 'Tap Permissions → Location → Allow.' },
        { step: 'Reload this page.' },
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

export function GpsPermissionHelp({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  // Platform detection runs client-side only to avoid an SSR/hydration
  // mismatch on the userAgent string.
  const [platform, setPlatform] = React.useState<Platform>('unknown');
  React.useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const steps = stepsFor(platform);

  return (
    <div className="rounded-2xl bg-amber-950/30 border border-amber-800 p-4 my-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-900/50 text-amber-300 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-200">
            Location is blocked for this site
          </h3>
          <p className="mt-1 text-xs text-amber-300">
            We can&rsquo;t re-ask for permission &mdash; the browser won&rsquo;t let
            us prompt again once it&rsquo;s been denied. Allow location for this
            site, then come back here:
          </p>
          <ol className="mt-3 space-y-1.5 text-xs text-amber-100 list-decimal list-inside">
            {steps.map((s, i) => (
              <li key={i}>{s.step}</li>
            ))}
          </ol>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-amber-50 text-xs font-medium px-3 py-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
