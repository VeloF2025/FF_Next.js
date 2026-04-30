/**
 * Add-to-home-screen install prompt for the /my staff portal.
 *
 * Renders a small banner above the hub on the first visit, dismissible
 * and remembered in localStorage so we don't nag returning users.
 *
 * Two paths depending on the browser:
 *   - Android Chrome (and Edge, Samsung Internet, etc) — fires the
 *     `beforeinstallprompt` event. We capture and stash it so a tap on
 *     "Install" can `prompt()` programmatically.
 *   - iOS Safari — no programmatic install API. We render an inline
 *     instruction step with the Share-icon glyph instead.
 *
 * Hidden completely on:
 *   - browsers already launched in standalone mode (the user installed it)
 *   - desktop browsers (the install banner is for phones)
 *   - any platform we can't categorise — better to be silent than wrong
 */

import React from 'react';
import { Share, Plus, X, Download } from 'lucide-react';

const DISMISS_KEY = 'vf-my-install-dismissed';

type InstallPlatform = 'android-prompt' | 'ios-safari' | 'hidden';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform(): InstallPlatform {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'hidden';

  // Already installed: launched in standalone display mode.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    // iOS Safari uses a non-standard navigator.standalone flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'hidden';

  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);

  if (isIos && isSafari) return 'ios-safari';
  if (isAndroid) return 'android-prompt';
  return 'hidden';
}

export function InstallPrompt() {
  const [platform, setPlatform] = React.useState<InstallPlatform>('hidden');
  const [dismissed, setDismissed] = React.useState(true);
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [iosExpanded, setIosExpanded] = React.useState(false);

  React.useEffect(() => {
    const detected = detectPlatform();
    setPlatform(detected);

    if (detected === 'hidden') return;

    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      // Private mode / disabled storage — show the prompt; the user can
      // still dismiss it for the session, just not durably.
      setDismissed(false);
    }

    if (detected !== 'android-prompt') return;

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = React.useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // See note in detectPlatform effect — best effort.
    }
    setDismissed(true);
  }, []);

  const handleAndroidInstall = React.useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      dismiss();
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, dismiss]);

  if (platform === 'hidden' || dismissed) return null;

  if (platform === 'android-prompt') {
    // Wait until the browser has fired beforeinstallprompt — without it
    // the prompt() call is a no-op, so showing the button would be a lie.
    if (!deferredPrompt) return null;
    return (
      <Banner onDismiss={dismiss}>
        <div className="flex items-start gap-3">
          <span className="flex w-9 h-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300 shrink-0">
            <Download className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-neutral-100">Install Velocity Fibre</div>
            <div className="text-xs text-neutral-400">Add to your home screen for one-tap clock-in.</div>
          </div>
          <button
            type="button"
            onClick={handleAndroidInstall}
            className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Install
          </button>
        </div>
      </Banner>
    );
  }

  // iOS Safari path — manual Share → Add to Home Screen instructions.
  return (
    <Banner onDismiss={dismiss}>
      <div className="flex items-start gap-3">
        <span className="flex w-9 h-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300 shrink-0">
          <Share className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-neutral-100">Install on your iPhone</div>
          {iosExpanded ? (
            <ol className="mt-2 space-y-1.5 text-xs text-neutral-300 list-decimal list-inside">
              <li className="flex items-center gap-1.5">
                Tap the Share icon
                <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-neutral-800">
                  <Share className="w-3 h-3" />
                </span>
                in Safari&rsquo;s toolbar.
              </li>
              <li className="flex items-center gap-1.5">
                Scroll and tap &ldquo;Add to Home Screen&rdquo;
                <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-neutral-800">
                  <Plus className="w-3 h-3" />
                </span>
                .
              </li>
              <li>Tap &ldquo;Add&rdquo; in the top-right corner.</li>
            </ol>
          ) : (
            <button
              type="button"
              onClick={() => setIosExpanded(true)}
              className="text-xs text-blue-400 hover:text-blue-300 underline mt-0.5"
            >
              Show me how
            </button>
          )}
        </div>
      </div>
    </Banner>
  );
}

function Banner({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 relative rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-3">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss install prompt"
        className="absolute top-1 right-1 inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="pr-12">{children}</div>
    </div>
  );
}
