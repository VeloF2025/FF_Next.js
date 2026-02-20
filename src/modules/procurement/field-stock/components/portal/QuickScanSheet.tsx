/**
 * QuickScanSheet Component
 * Bottom-sheet displayed after a quick-scan FAB result.
 * Shows serial details + quick actions (consume, view).
 * If serial not found, offers to navigate to registration.
 */

import { X, Package, ScanLine, AlertCircle, Loader2 } from 'lucide-react';
import type { SerialLookupResult } from './types';

interface QuickScanSheetProps {
  isOpen: boolean;
  scannedCode: string;
  lookupResult: SerialLookupResult | null;
  loading: boolean;
  onClose: () => void;
  onConsume: () => void;
  onNavigateToConsume: (drNumber?: string) => void;
}

/**
 * Animated bottom sheet rendered over home view after quick scan.
 * Does not use a modal overlay — overlays are managed by the parent.
 */
export function QuickScanSheet({
  isOpen,
  scannedCode,
  lookupResult,
  loading,
  onClose,
  onConsume,
  onNavigateToConsume,
}: QuickScanSheetProps) {
  if (!isOpen) return null;

  const isDrCode =
    /^DR[-–]\d+$/i.test(scannedCode) || /^\d{5,}$/.test(scannedCode);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-3 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="px-4 pb-6 space-y-4">
          {/* Scanned code */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Scanned</p>
            <p className="font-mono font-semibold text-gray-900 dark:text-white text-lg">
              {scannedCode}
            </p>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="text-sm text-gray-500">Looking up serial…</span>
            </div>
          )}

          {/* DR-like code */}
          {!loading && isDrCode && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <ScanLine className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  This looks like a DR number. Go to Scan & Install?
                </p>
              </div>
              <button
                onClick={() => onNavigateToConsume(scannedCode)}
                className="w-full min-h-[56px] bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors"
              >
                Open Scan & Install
              </button>
            </div>
          )}

          {/* Serial found */}
          {!loading && !isDrCode && lookupResult?.found && (
            <div className="space-y-3">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold text-gray-900 dark:text-white text-sm">
                    {lookupResult.itemName ?? 'Unknown item'}
                  </span>
                </div>
                {lookupResult.itemCode && (
                  <p className="text-xs text-gray-500">Code: {lookupResult.itemCode}</p>
                )}
                {lookupResult.status && (
                  <p className="text-xs text-gray-500">
                    Status: <span className="capitalize">{lookupResult.status}</span>
                  </p>
                )}
                {lookupResult.locationName && (
                  <p className="text-xs text-gray-500">Location: {lookupResult.locationName}</p>
                )}
              </div>

              <button
                onClick={onConsume}
                className="w-full min-h-[56px] bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors"
              >
                Record Installation (Scan & Install)
              </button>
            </div>
          )}

          {/* Serial not found */}
          {!loading && !isDrCode && lookupResult && !lookupResult.found && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Serial not found in system.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full min-h-[48px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
