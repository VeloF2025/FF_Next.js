// src/modules/sitecam/components/SerialScanStep.tsx
import { useState, useId } from 'react';
import { AlertTriangle, CheckCircle, Clock, Flashlight, Keyboard, Loader2, Scan } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { log } from '@/lib/logger';
import { normaliseSerialCandidate } from '../lib/serialCandidate';
const MODULE = 'SerialScanStep';
const SAVE_TIMEOUT_MS = 15_000;
interface Props {
  stepNumber: number;
  serialLabel: string;
  serialDevice: 'ont' | 'ups';
  serialAttempts: number;
  drNumber: string;
  onScanSaved: (serial: string) => void;
}
export function SerialScanStep({ stepNumber, serialLabel, serialDevice, serialAttempts, drNumber, onScanSaved }: Props) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [crossRefStatus, setCrossRefStatus] = useState<'verified' | 'mismatch' | 'pending' | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [manualSerial, setManualSerial] = useState('');
  const scanElementId = useId().replace(/:/g, '-');
  const prefix = serialDevice === 'ont' ? 'ALCL' : 'GU';
  const helperText = serialDevice === 'ont'
    ? 'Point the camera at the ONT sticker barcode, or type the serial printed under it.'
    : 'Point the camera at the UPS barcode, or type the serial printed under it.';
  async function submitScan(scanned: string) {
    const normalised = normaliseSerialCandidate(scanned, prefix);
    if (!normalised) {
      setInvalidMsg(`Enter or scan the ${serialLabel}.`);
      return;
    }
    setLoading(true);
    setInvalidMsg(null);
    setLastScanned(normalised);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/my/sitecam/verify-serial', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          drNumber,
          step: stepNumber,
          scannedSerial: normalised,
          attemptNumber: serialAttempts + 1,
        }),
      });
      const json = await res.json().catch(() => null) as {
        data?: {
          result: 'saved' | 'invalid_format';
          serial: string;
          message: string;
          crossRefStatus?: 'verified' | 'mismatch' | 'pending';
        };
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        setInvalidMsg(json?.error ?? json?.message ?? `Could not save serial (HTTP ${res.status}). Try again.`);
        return;
      }
      if (!json?.data) {
        setInvalidMsg('Could not save serial — the server returned an unexpected response. Try again.');
        return;
      }
      const { result, serial, message, crossRefStatus: refStatus } = json.data;
      if (result === 'saved') {
        setSavedSerial(serial);
        setSavedMessage(message);
        setCrossRefStatus(refStatus ?? 'pending');
        onScanSaved(serial);
      } else {
        setInvalidMsg(message);
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort
        ? 'Saving timed out. Check signal and tap Save again — your typed/scanned serial is still here.'
        : 'Network error while saving. Check signal and tap Save again — your typed/scanned serial is still here.';
      log.error('Verify serial failed', { err: String(err) }, MODULE);
      setInvalidMsg(msg);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
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
      if (loading) return;
      setLastScanned(result.decodedText);
      setManualSerial(normaliseSerialCandidate(result.decodedText, prefix));
      await stop();
      setScanning(false);
      await submitScan(result.decodedText);
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
    const tone =
      crossRefStatus === 'verified'
        ? { border: 'border-green-800', bg: 'bg-green-950/40', text: 'text-green-300', icon: 'text-green-400' }
        : crossRefStatus === 'mismatch'
          ? { border: 'border-amber-800', bg: 'bg-amber-950/40', text: 'text-amber-300', icon: 'text-amber-400' }
          : { border: 'border-sky-800', bg: 'bg-sky-950/40', text: 'text-sky-300', icon: 'text-sky-400' };
    return (
      <div className={`flex flex-col items-center gap-3 rounded-xl border ${tone.border} ${tone.bg} py-8 px-4`}>
        {crossRefStatus === 'verified' ? <CheckCircle className={`h-8 w-8 ${tone.icon}`} /> : <Clock className={`h-8 w-8 ${tone.icon}`} />}
        <p className={`text-sm font-medium ${tone.text}`}>Serial saved — {savedSerial}</p>
        <p className="text-xs text-neutral-500 text-center">{savedMessage ?? 'Cross-reference pending (1Map + OES)'}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 space-y-2">
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
      {!scanning && !loading && (
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
        <button type="button" disabled={loading || manualSerial.trim().length === 0} onClick={() => void submitScan(manualSerial)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : `Save ${serialLabel}`}
        </button>
        <p className="text-xs text-neutral-500">If the camera cannot read the barcode, type the serial exactly as printed and save.</p>
      </div>
    </div>
  );
}
