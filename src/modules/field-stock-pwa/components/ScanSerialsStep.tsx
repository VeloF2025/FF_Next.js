'use client';

/**
 * ScanSerialsStep — step 3 of the stores issue flow.
 *
 * Camera-first barcode scanning with manual-entry fallback.
 * Validation logic lives in hooks/useScanSerial.ts.
 * Per-row display lives in SerialChip.tsx.
 *
 * Scan flow:
 *   camera scan → useScanSerial.handleRawSerial → validateSerial API →
 *   resolved PwaScannedSerial (valid | invalid) → onChange callback
 *
 * De-dup: silent on duplicate scans (haptic 30ms only).
 * "Done scanning" is enabled only when ≥1 valid and 0 pending.
 */

import { useState, useCallback } from 'react';
import { Camera, CameraOff, Loader2, ChevronDown } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { useScanSerial } from '@/modules/field-stock-pwa/hooks/useScanSerial';
import { SerialChip } from '@/modules/field-stock-pwa/components/SerialChip';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

const SCANNER_ELEMENT_ID = 'serial-scanner-reader';

export interface ScanSerialsStepProps {
  stockItem: { id: string; name: string };
  scanned: PwaScannedSerial[];
  onChange: (next: PwaScannedSerial[]) => void;
  onDone: () => void;
}

export function ScanSerialsStep({
  stockItem,
  scanned,
  onChange,
  onDone,
}: ScanSerialsStepProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const { handleRawSerial, handleRemove } = useScanSerial({ stockItem, scanned, onChange });

  const validCount = scanned.filter((s) => s.state === 'valid').length;
  const hasPending = scanned.some((s) => s.state === 'pending-validation');
  const canDone = validCount > 0 && !hasPending;

  // Camera scanner
  const { state: scannerState, start, stop, error: scannerError } = useBarcodeScanner({
    elementId: SCANNER_ELEMENT_ID,
    onScan: (result) => { handleRawSerial(result.decodedText); },
  });

  const openScanner = useCallback(async () => { setScannerOpen(true); await start(); }, [start]);
  const closeScanner = useCallback(async () => { await stop(); setScannerOpen(false); }, [stop]);

  const handleManualSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualInput.trim()) return;
      handleRawSerial(manualInput);
      setManualInput('');
    },
    [manualInput, handleRawSerial]
  );

  return (
    <div className="space-y-3">
      {/* Context header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <div>
          <span className="text-xs text-neutral-400">Item: </span>
          <span className="text-sm font-medium text-white">{stockItem.name}</span>
        </div>
        <span className="text-xs font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded">
          {validCount} valid
        </span>
      </div>

      {/* Scanner viewport */}
      {scannerOpen && (
        <div className="rounded-lg overflow-hidden border border-neutral-700 bg-black">
          <div id={SCANNER_ELEMENT_ID} className="w-full" style={{ minHeight: '240px' }} />
          {scannerState === 'initializing' && (
            <div className="flex items-center justify-center py-6 gap-2 text-neutral-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Starting camera…
            </div>
          )}
          {scannerState === 'error' && (
            <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
              <CameraOff className="w-8 h-8 text-rose-400" />
              <p className="text-rose-300 text-sm">{scannerError ?? 'Camera access required'}</p>
            </div>
          )}
          <button
            type="button"
            onClick={closeScanner}
            className="w-full py-3 text-sm text-neutral-400 hover:text-white border-t border-neutral-800"
          >
            Close scanner
          </button>
        </div>
      )}

      {/* Open scanner button */}
      {!scannerOpen && (
        <button
          type="button"
          onClick={openScanner}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-lg bg-neutral-900 border border-neutral-700 text-white hover:bg-neutral-800 active:bg-neutral-700 text-sm font-medium"
        >
          <Camera className="w-5 h-5" /> Open scanner
        </button>
      )}

      {/* Manual entry disclosure */}
      <div>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${manualOpen ? 'rotate-180' : ''}`} />
          Type serial instead
        </button>
        {manualOpen && (
          <form onSubmit={handleManualSubmit} className="mt-2 flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Serial number"
              className="flex-1 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className="px-4 py-2 rounded-lg bg-neutral-700 text-white text-sm font-medium disabled:opacity-40"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* Scanned list */}
      {scanned.length > 0 && (
        <ul className="space-y-1.5">
          {[...scanned].reverse().map((row) => (
            <SerialChip key={row.serialNumber} serial={row} onRemove={handleRemove} />
          ))}
        </ul>
      )}

      {/* Done button */}
      <button
        type="button"
        onClick={onDone}
        disabled={!canDone}
        className="w-full py-3.5 rounded-lg bg-emerald-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-600 active:bg-emerald-800"
      >
        Done scanning ({validCount} serial{validCount !== 1 ? 's' : ''})
      </button>
    </div>
  );
}
