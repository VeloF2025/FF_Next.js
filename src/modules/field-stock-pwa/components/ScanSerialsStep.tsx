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
import { BoxGroupChip } from '@/modules/field-stock-pwa/components/BoxGroupChip';
import { ScanNoticeBanner } from '@/modules/field-stock-pwa/components/ScanNoticeBanner';
import { PhotoSerialFallback } from '@/modules/field-stock-pwa/components/PhotoSerialFallback';
import { LabelPhotoCapture } from '@/modules/field-stock-pwa/components/LabelPhotoCapture';
import { buildScanRows } from '@/modules/field-stock-pwa/lib/scanRows';
import { batchWarning } from '@/modules/field-stock-pwa/lib/batchWarning';
import { scanRegionFor } from '@/modules/field-stock-pwa/lib/scanBox';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

const SCANNER_ELEMENT_ID = 'serial-scanner-reader';

export interface ScanSerialsStepProps {
  stockItem: { id: string; name: string };
  scanned: PwaScannedSerial[];
  onChange: (next: PwaScannedSerial[]) => void;
  onDone: () => void;
  /** Selected source warehouse — serials registered elsewhere are rejected at scan time. */
  sourceLocation?: { id: string; name: string } | null;
}

export function ScanSerialsStep({
  stockItem,
  scanned,
  onChange,
  onDone,
  sourceLocation,
}: ScanSerialsStepProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  /** Serial currently having its label photographed, if any. */
  const [photographing, setPhotographing] = useState<string | null>(null);
  const [fallbackHint, setFallbackHint] = useState<string | null>(null);

  const {
    handleRawSerial, handleRemove, handleRemoveGroup, scanNotice, clearScanNotice,
    attachIntakePhoto,
  } =
    useScanSerial({ stockItem, scanned, onChange, sourceLocation });

  const renderRows = buildScanRows(scanned);
  const validCount = scanned.filter((s) => s.state === 'valid').length;
  const hasPending = scanned.some((s) => s.state === 'pending-validation');
  const canDone = validCount > 0 && !hasPending;
  const overBatchWarning = batchWarning(validCount);

  // Camera scanner.
  // Equipment serial labels (e.g. Nokia GPON ONT) carry the GPON SN in a
  // DATA_MATRIX square plus a CODE_128 1D barcode under the printed S/N. The
  // hook's default format set omits DATA_MATRIX, so the prominent square never
  // decoded — the camera showed live video but read nothing. Enable DATA_MATRIX
  // alongside the common 1D formats so either code on the label scans.
  // Dense Code128 (Gizzu 18-char serial on a ~3 cm sticker) additionally needs
  // the native BarcodeDetector API (Android Chrome) + hi-res frames + a wide
  // 1D-shaped scan box to reliably decode at live-video distances.
  const { state: scannerState, start, stop, error: scannerError } = useBarcodeScanner({
    elementId: SCANNER_ELEMENT_ID,
    config: {
      formatsToSupport: ['DATA_MATRIX', 'QR_CODE', 'CODE_128', 'CODE_39', 'EAN_13', 'EAN_8'],
      useBarCodeDetectorIfSupported: true,
      // Sized per axis from the live viewfinder. The previous fixed 300x140
      // region was shaped for a 1D barcode and cut the carton's serial-list
      // DataMatrix in half, so the live camera could not read a label that
      // decodes fine from a still photo (field report 2026-08-21).
      qrboxSize: scanRegionFor,
      videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    },
    // Live camera: read from a printed barcode, so it may take in a serial
    // the stock sheet has never listed.
    onScan: (result) => { handleRawSerial(result.decodedText, 'machine'); },
  });

  const openScanner = useCallback(async () => { setScannerOpen(true); await start(); }, [start]);
  const closeScanner = useCallback(async () => { await stop(); setScannerOpen(false); }, [stop]);

  const handleManualSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualInput.trim()) return;
      // Typed by hand: NOT machine-read. An unknown serial here is refused,
      // because a typo would become a permanent phantom ONT issued to a named
      // technician and could never reconcile against the sheet.
      handleRawSerial(manualInput, 'manual');
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
          <p className="px-3 py-1.5 text-[11px] text-neutral-500 text-center">
            Keep the code inside the frame with a little space around it — filling
            the frame edge to edge stops it reading. Carton labels also scan
            reliably from a photo: use the button below.
          </p>
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

      {/* Photo-to-serial fallback */}
      <PhotoSerialFallback
        onSerial={(serial) => { setFallbackHint(null); setManualOpen(true); setManualInput(serial); }}
        onSerials={(serials) => {
          // Re-enter through the same parser the camera uses, so the photo path
          // and the scan path share one code path and one set of tests.
          setFallbackHint(null);
          // Photo decode: still a machine read of a printed code.
          void handleRawSerial(serials.join(';'), 'machine');
        }}
        onNoSerial={(msg) => { setFallbackHint(msg); setManualOpen(true); }}
      />
      {fallbackHint && <p className="text-xs text-amber-400">{fallbackHint}</p>}

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

      {/* Wrong code scanned, short read, oversized box, or ledger drift */}
      {scanNotice && <ScanNoticeBanner notice={scanNotice} onDismiss={clearScanNotice} />}

      {/* Scanned list — cartons collapse to one row, loose units render as before */}
      {scanned.length > 0 && (
        <ul className="space-y-1.5">
          {renderRows.map((row) =>
            row.type === 'group' ? (
              <BoxGroupChip
                key={row.groupId}
                groupId={row.groupId}
                label={row.label}
                members={row.members}
                onRemoveGroup={handleRemoveGroup}
                onRemoveMember={handleRemove}
              />
            ) : (
              <SerialChip
                key={row.serial.serialNumber}
                serial={row.serial}
                onRemove={handleRemove}
                onPhotograph={setPhotographing}
              />
            ),
          )}
        </ul>
      )}

      {/* Label photo for a single unit the sheet has never listed — the Gizzu
          case, where there is no carton to corroborate it. */}
      {photographing && (
        <LabelPhotoCapture
          serialNumber={photographing}
          onCaptured={(photo) => { attachIntakePhoto(photographing, photo); setPhotographing(null); }}
          onCancel={() => setPhotographing(null)}
        />
      )}

      {overBatchWarning && <p className="text-xs text-amber-400 px-1">{overBatchWarning}</p>}

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
