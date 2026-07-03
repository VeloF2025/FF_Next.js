/**
 * Dismissible "Install FibreFlow" affordance. Captures the browser's
 * beforeinstallprompt event, offers a native install, and remembers a
 * dismissal in localStorage so we don't nag. Renders nothing until the event
 * fires (so it never shows on desktop browsers that don't offer install, or
 * when already installed).
 */

import { useEffect, useState } from 'react';

import { log } from '@/lib/logger';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ff-install-dismissed';

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      log.info('[pwa] install prompt outcome', { outcome });
    } catch (err) {
      log.error('[pwa] install prompt failed', { err });
    } finally {
      setDeferred(null);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-gray-700 bg-[#1e2128] px-4 py-3 text-sm text-gray-100 shadow-lg">
      <span>Install FibreFlow for a faster, offline-ready experience.</span>
      <button onClick={install} className="rounded bg-[#5B8DEF] px-3 py-1 font-medium text-white">
        Install
      </button>
      <button onClick={dismiss} className="px-2 py-1 text-gray-400">
        Not now
      </button>
    </div>
  );
}
