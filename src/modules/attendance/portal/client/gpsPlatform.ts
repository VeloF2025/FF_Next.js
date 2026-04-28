/**
 * UA-based browser classification for the geolocation help banner, and
 * pure helpers for resolving how to react to a PERMISSION_DENIED from
 * getCurrentPosition given the live Permissions API state.
 *
 * Detection uses userAgent sniffing, which is imperfect but good enough
 * for a "here's a recipe" UI. We default to a generic path if we can't
 * confidently match.
 *
 * Pulled out of GpsPermissionHelp.tsx so the component file only exports
 * a component (Fast Refresh requirement).
 */

/**
 * Possible return values from queryGeolocationPermission(). Mirrors the
 * Permissions API state plus an 'unsupported' fallback for browsers that
 * don't implement it.
 */
export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * After getCurrentPosition has fired PERMISSION_DENIED, classify the
 * follow-up action based on the live Permissions API state.
 *
 *   - 'show-help'  → 'denied' or 'unsupported': we cannot recover in-app,
 *                    show the platform-specific settings recipe.
 *   - 'retry'      → 'granted': the deny was a transient race; retry
 *                    the capture immediately (no error shown to the
 *                    user — this would be a confusing message since
 *                    the browser reports the permission as granted).
 *   - 'soft-error' → 'prompt': the user dismissed the native prompt.
 *                    Show a soft error so the next tap (user gesture)
 *                    can re-trigger the prompt in-app.
 */
export type DenialFollowup = 'show-help' | 'retry' | 'soft-error';

export function classifyDenialFollowup(state: GeolocationPermissionState): DenialFollowup {
  if (state === 'denied' || state === 'unsupported') return 'show-help';
  if (state === 'granted') return 'retry';
  return 'soft-error';
}

export type Platform =
  | 'ios-safari'
  | 'ios-other'
  | 'android-samsung'
  | 'android-chrome'
  | 'desktop-chrome'
  | 'desktop-safari'
  | 'desktop-firefox'
  | 'unknown';

/**
 * Pure UA classifier. Pass `ua` and `maxTouchPoints` for tests; in
 * production, omit them and the function reads from `navigator`.
 */
export function detectPlatform(uaArg?: string, maxTouchPoints = 0): Platform {
  const ua = uaArg ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (!ua) return 'unknown';
  const touchPoints = uaArg !== undefined
    ? maxTouchPoints
    : typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (touchPoints > 1 && /Macintosh/.test(ua));
  const isAndroid = /Android/.test(ua);
  // Samsung Internet identifies itself with `SamsungBrowser/<ver>` and
  // ALSO carries the generic `Chrome/<ver>` token because it's Chromium-
  // based. We must check Samsung first; otherwise the Chrome branch
  // captures it and shows the wrong settings path.
  const isSamsung = /SamsungBrowser/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|SamsungBrowser/.test(ua);
  const isChrome = /Chrome/.test(ua) || /CriOS/.test(ua);
  const isFirefox = /Firefox/.test(ua) || /FxiOS/.test(ua);

  if (isIos && isSafari) return 'ios-safari';
  if (isIos) return 'ios-other';
  if (isAndroid && isSamsung) return 'android-samsung';
  if (isAndroid && isChrome) return 'android-chrome';
  if (isChrome) return 'desktop-chrome';
  if (isSafari) return 'desktop-safari';
  if (isFirefox) return 'desktop-firefox';
  return 'unknown';
}
