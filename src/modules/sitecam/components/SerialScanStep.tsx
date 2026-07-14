// src/modules/sitecam/components/SerialScanStep.tsx
import { useState, useId } from 'react';
import { AlertTriangle, Flashlight, Keyboard, Scan } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { log } from '@/lib/logger';
import { normaliseSerialCandidate } from '../lib/serialCandidate';
import { saveSerial } from '../lib/saveSerial';
import { SerialConfirmCard, SerialSavedCard } from './SerialScanCards';
const MODULE = 'SerialScanStep';
interface Props {
  stepNumber: number;
  serialLabel: string;
  serialDevice: 'ont' | 'ups';
  serialAttempts: number;
  drNumber: string;
  onScanSaved: (serial: string) => void;
  /** Position of this serial within a multi-serial step (e.g. 6a/6b), for the hint. */
  serialPosition?: { index: number; total: number };
}
export function SerialScanStep({ stepNumber, serialLabel, serialDevice, serialAttempts, drNumber, onScanSaved, serialPosition }: Props) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [crossRefStatus, setCrossRefStatus] = useState<'verified' | 'mismatch' | 'pending' | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [manualSerial, setManualSerial] = useState('');
  // A captured candidate awaiting the technician's explicit confirmation. Nothing
  // is POSTed until they confirm it — a mis-read barcode can be rejected first.
  const [pendingSerial, setPendingSerial] = useState<string | null>(null);
  const scanElementId = useId().replace(/:/g, '-');
  const prefix = serialDevice === 'ont' ? 'ALCL' : 'GU';
  const positionLabel =
    serialPosition && serialPosition.total > 1
      ? `Serial ${serialPosition.index + 1} of ${serialPosition.total}`
      : null;
  const helperText = serialDevice === 'ont'
    ? 'Point the camera at the ONT sticker barcode, or type the serial printed under it.'
    : 'Point the camera at the UPS barcode, or type the serial printed under it.';

  // Capture a candidate (scanned or typed) for review — does NOT save it.
  function reviewCandidate(scanned: string) {
    const normalised = normaliseSerialCandidate(scanned, prefix);
    if (!normalised) {
      setInvalidMsg(`Enter or scan the ${serialLabel}.`);
      return;
    }
    setInvalidMsg(null);
    setScanning(false);
    setManualSerial(normalised);
    setPendingSerial(normalised);
  }

  // Save a confirmed serial to the server (called from the confirm card).
  async function submitScan(scanned: string) {
    setLoading(true);
    setInvalidMsg(null);
    setLastScanned(scanned);
    const result = await saveSerial({
      drNumber,
      step: stepNumber,
      device: serialDevice,
      scannedSerial: scanned,
      attemptNumber: serialAttempts + 1,
    });
    setLoading(false);
    // Any non-saved outcome returns to the scan/manual UI (typed serial retained)
    // so the reason is visible and the technician can review + confirm again.
    setPendingSerial(null);
    if (result.kind === 'saved') {
      setSavedSerial(result.serial);
      setSavedMessage(result.message);
      setCrossRefStatus(result.crossRefStatus);
      onScanSaved(result.serial);
    } else {
      setInvalidMsg(result.message);
    }
  }
  const { start, stop, error: scannerError, toggleTorch, isTorchOn } = useBarcodeScanner({
    elementId: scanElementId,
    config: {
      facingMode: 'environment',
      fps: 12,
      qrboxSize: { width: 320, height: 180 },
      aspectRatio: 1.777,
      useBarCodeDetectorIfSupported: true,
      formatsToSupport: ['CODE_128', 'CODE_39', 'QR_CODE', 'DATA_MATRIX'],
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    onError: (message) => setInvalidMsg(`Could not start camera scanner: ${message}. Use manual entry below.`),
    onScan: async (result) => {
      if (loading || pendingSerial) return;
      setLastScanned(result.decodedText);
      await stop();
      reviewCandidate(result.decodedText);
    },
  });
  function handleScanClick() {
    setScanning(true);
    setInvalidMsg(null);
    setSavedSerial(null);
    start().catch((e) => {
      log.warn('Scanner start error', { e: String(e) }, MODULE);
      setInvalidMsg('Could not start camera scanner. Check camera permission, then try again or use manual entry below.');
      setScanning(false);
    });
  }

  if (savedSerial) {
    return <SerialSavedCard serial={savedSerial} crossRefStatus={crossRefStatus} message={savedMessage} />;
  }

  if (pendingSerial) {
    return (
      <SerialConfirmCard
        serialLabel={serialLabel}
        serial={pendingSerial}
        positionLabel={positionLabel}
        loading={loading}
        onConfirm={() => void submitScan(pendingSerial)}
        onRescan={() => { setPendingSerial(null); setInvalidMsg(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 space-y-2">
        {positionLabel && <p className="text-xs font-medium uppercase tracking-wide text-sky-300">{positionLabel}</p>}
        <p className="text-sm font-medium text-neutral-200">Scan {serialLabel}</p>
        <p className="text-xs text-neutral-500">{helperText}</p>
        <p className="text-xs text-neutral-500">Expected prefix: <span className="font-mono text-neutral-300">{prefix}</span></p>
        {serialAttempts > 0 && <p className="text-xs text-neutral-500">Attempt {serialAttempts + 1}</p>}
      </div>
      {scanning && (
        <div className="space-y-2">
          <div id={scanElementId} className="overflow-hidden rounded-xl border border-neutral-700 bg-black" style={{ width: '100%', minHeight: 260 }} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void toggleTorch()} className="flex items-center justify-center gap-2 rounded-lg border border-neutral-700 py-2 text-xs text-neutral-300">
              <Flashlight className="h-4 w-4" /> {isTorchOn ? 'Torch off' : 'Torch on'}
            </button>
            <button type="button" onClick={() => { void stop(); setScanning(false); }} className="rounded-lg border border-neutral-700 py-2 text-xs text-neutral-300">
              Stop scanner
            </button>
          </div>
        </div>
      )}
      {(invalidMsg || scannerError) && (
        <div className="flex items-start gap-2 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="text-sm text-red-300">{invalidMsg ?? scannerError}</p>
            {lastScanned && <p className="mt-0.5 text-xs text-neutral-500">Last value: <span className="font-mono">{lastScanned}</span></p>}
          </div>
        </div>
      )}
      {!scanning && (
        <button type="button" onClick={handleScanClick} className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-600 bg-neutral-900 py-7 hover:border-sky-500 hover:bg-neutral-800 active:bg-neutral-800/60 transition-colors">
          <Scan className="h-8 w-8 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-300">{serialAttempts === 0 ? `Scan ${serialLabel}` : 'Retry Scan'}</span>
        </button>
      )}
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 space-y-3">
        <label htmlFor={`${scanElementId}-manual`} className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <Keyboard className="h-4 w-4" /> Manual {serialLabel}
        </label>
        <input
          id={`${scanElementId}-manual`}
          value={manualSerial}
          onChange={(e) => setManualSerial(normaliseSerialCandidate(e.target.value, prefix))}
          placeholder={`${prefix}...`}
          autoCapitalize="characters"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 font-mono text-sm text-neutral-100 outline-none focus:border-sky-500"
        />
        <button type="button" disabled={manualSerial.trim().length === 0} onClick={() => reviewCandidate(manualSerial)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          Review {serialLabel}
        </button>
        <p className="text-xs text-neutral-500">If the camera cannot read the barcode, type the serial exactly as printed, then review and confirm.</p>
      </div>
    </div>
  );
}
