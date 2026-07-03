/**
 * Shown when the root service worker has a new version waiting. Tapping
 * "Reload" activates the waiting worker and reloads. Rendered app-wide from
 * _app.tsx. Uses the root SW registration hook.
 */

import { useAppServiceWorker } from '@/hooks/useAppServiceWorker';

export function UpdatePrompt() {
  const { updateAvailable, updateServiceWorker } = useAppServiceWorker();
  if (!updateAvailable) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gray-700 bg-[#1e2128] px-4 py-3 text-sm text-gray-100 shadow-lg">
      <span>A new version of FibreFlow is available.</span>
      <button onClick={updateServiceWorker} className="rounded bg-[#5B8DEF] px-3 py-1 font-medium text-white">
        Reload
      </button>
    </div>
  );
}
