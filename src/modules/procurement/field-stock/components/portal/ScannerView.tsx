/**
 * ScannerView Component
 * Reusable barcode scanner viewfinder with manual entry fallback.
 * Mounts the html5-qrcode scanner into a named DOM element.
 */

import React, { useState } from 'react';
import { ScanLine, Flashlight, FlashlightOff, AlertCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useBarcodeScanner } from '@/modules/barcode-scanner';
import type { ScanResult } from '@/modules/barcode-scanner';

interface ScannerViewProps {
  /** Unique element ID for the scanner mount point */
  elementId: string;
  /** Called when a code is scanned or manually entered */
  onCode: (code: string) => void;
  /** Optional label for manual entry placeholder */
  manualPlaceholder?: string;
  /** Whether duplicate scans should be reported (default: false) */
  allowDuplicates?: boolean;
  /** Set of already-scanned codes for duplicate detection */
  scannedSet?: Set<string>;
}

/**
 * Embeddable scanner view — no modal, just the viewfinder + controls.
 * Starts scanning automatically on mount and cleans up on unmount.
 */
export function ScannerView({
  elementId,
  onCode,
  manualPlaceholder = 'Enter serial number…',
  allowDuplicates = false,
  scannedSet,
}: ScannerViewProps) {
  const [manualInput, setManualInput] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const handleScanResult = (result: ScanResult) => {
    const code = result.decodedText.trim();
    if (!allowDuplicates && scannedSet?.has(code)) {
      setDuplicateWarning(`"${code}" already scanned`);
      // Vibrate to signal duplicate
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      return;
    }
    setDuplicateWarning(null);
    if (navigator.vibrate) navigator.vibrate(80);
    onCode(code);
  };

  const { state, start, stop, toggleTorch, isTorchOn, error } = useBarcodeScanner({
    elementId,
    onScan: handleScanResult,
  });

  // Auto-start on mount
  React.useEffect(() => {
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualInput.trim();
    if (!code) return;
    if (!allowDuplicates && scannedSet?.has(code)) {
      setDuplicateWarning(`"${code}" already scanned`);
      return;
    }
    setDuplicateWarning(null);
    onCode(code);
    setManualInput('');
  };

  return (
    <div className="space-y-3">
      {/* Scanner viewfinder mount point */}
      <div className="relative rounded-xl overflow-hidden bg-black">
        <div id={elementId} className="w-full" style={{ minHeight: 220 }} />

        {/* Status overlay when initializing */}
        {state === 'initializing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-center text-white">
              <InlineSpinner size="lg" className="mx-auto mb-2" />
              <p className="text-sm">Starting camera…</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {state === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
            <div className="text-center text-white">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-400" />
              <p className="text-sm text-red-300">{error || 'Camera error'}</p>
              <button
                onClick={start}
                className="mt-2 px-3 py-1.5 bg-white/20 rounded-lg text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Torch toggle */}
        {state === 'scanning' && (
          <button
            onClick={toggleTorch}
            className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white"
            aria-label={isTorchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
          >
            {isTorchOn
              ? <FlashlightOff className="w-5 h-5" />
              : <Flashlight className="w-5 h-5" />
            }
          </button>
        )}

        {/* Scanning indicator */}
        {state === 'scanning' && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 px-3 py-1 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-white">Scanning…</span>
          </div>
        )}
      </div>

      {/* Duplicate warning */}
      {duplicateWarning && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">{duplicateWarning}</p>
        </div>
      )}

      {/* Manual entry fallback */}
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder={manualPlaceholder}
          className="flex-1 min-h-[56px] px-4 text-base border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="min-h-[56px] px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-2 font-medium transition-colors"
        >
          <ScanLine className="w-5 h-5" />
          Add
        </button>
      </form>
    </div>
  );
}
