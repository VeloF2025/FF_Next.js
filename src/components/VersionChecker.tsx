/**
 * Version Checker Component
 * Checks for new deployments and prompts user to refresh
 * Subtle toast notification that matches app UI/UX
 */

'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export function VersionChecker() {
  const [showNotification, setShowNotification] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Get initial version from meta tag
    const metaVersion = document.querySelector('meta[name="build-version"]')?.getAttribute('content');
    setCurrentVersion(metaVersion || null);

    // Check for new version every 5 minutes
    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        const data = await response.json();

        if (data.version && currentVersion && data.version !== currentVersion) {
          setShowNotification(true);
          clearInterval(interval); // Stop checking once update detected
        }
      } catch {
        // Silently fail - don't interrupt user experience
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [currentVersion]);

  const handleDismiss = () => {
    setIsDismissed(true);
    // Show again after 30 minutes if not refreshed
    setTimeout(() => setIsDismissed(false), 30 * 60 * 1000);
  };

  if (!showNotification || isDismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-slate-800/95 backdrop-blur-sm border border-slate-700/50 rounded-lg shadow-xl p-3 max-w-xs">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200">
              Update available
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Refresh to get the latest features
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Refresh now &rarr;
            </button>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
