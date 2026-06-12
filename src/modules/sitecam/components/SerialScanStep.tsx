// src/modules/sitecam/components/SerialScanStep.tsx
import { useState, useId } from 'react';
import { AlertTriangle, Scan, Clock } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { log } from '@/lib/logger';

const MODULE = 'SerialScanStep';

interface Props {
  stepNumber: number;
  serialLabel: string;           // 'ONT Serial' or 'UPS Serial'
  serialDevice: 'ont' | 'ups';
  serialAttempts: number;
  drNumber: string;
  onScanSaved: (serial: string) => void;  // called when valid format saved to DB
}

export function SerialScanStep({
  stepNumber,
  serialLabel,
  serialDevice,
  serialAttempts,
  drNumber,
  onScanSaved,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [crossRefStatus, setCrossRefStatus] = useState<'verified' | 'mismatch' | 'pending' | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const scanElementId = useId().replace(/:/g, '-');

  const prefix = serialDevice === 'ont' ? 'ALCL' : 'GU';

  const { start, stop } = useBarcodeScanner({
    elementId: scanElementId,
    config: { facingMode: 'environment', fps: 10, qrboxSize: 300 },
    onScan: async (result) => {
      if (loading) return;
      setLastScanned(result.decodedText);
      await stop();
      setScanning(false);
      await submitScan(result.decodedText);
    },
  });

  async function submitScan(scanned: string) {
    setLoading(true);
    setInvalidMsg(null);
    try {
      const res = await fetch('/api/my/sitecam/verify-serial', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber,
          step: stepNumber,
          scannedSerial: scanned,
          attemptNumber: serialAttempts + 1,
        }),
      });
      const json = (await res.json()) as {
        data?: {
          result: 'saved' | 'invalid_format';
          serial: string;
          message: string;
          crossRefStatus?: 'verified' | 'mismatch' | 'pending';
        };
      };
      // A 4xx/5xx response has no data envelope — degrade to a retryable
      // message instead of throwing on the destructure.
      if (!json.data) {
        setInvalidMsg('Could not save serial — please try again');
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
      log.error('Verify serial failed', { err: String(err) }, MODULE);
      setInvalidMsg('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  function handleScanClick() {
    setScanning(true);
    setInvalidMsg(null);
    setSavedSerial(null);
    start().catch((e) => {
      log.warn('Scanner start error', { e: String(e) }, MODULE);
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
        {crossRefStatus === 'mismatch'
          ? <AlertTriangle className={`h-8 w-8 ${tone.icon}`} />
          : <Clock className={`h-8 w-8 ${tone.icon}`} />}
        <p className={`text-sm font-medium ${tone.text}`}>Serial saved — {savedSerial}</p>
        <p className="text-xs text-neutral-500 text-center">
          {savedMessage ?? 'Cross-reference pending (1Map + OES)'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 space-y-2">
        <p className="text-sm font-medium text-neutral-200">Scan {serialLabel}</p>
        <p className="text-xs text-neutral-500">
          {serialLabel} starts with <span className="font-mono text-neutral-300">{prefix}</span>
        </p>
        {serialAttempts > 0 && (
          <p className="text-xs text-neutral-500">Attempt {serialAttempts + 1}</p>
        )}
      </div>

      {scanning && (
        <div
          id={scanElementId}
          className="overflow-hidden rounded-xl border border-neutral-700"
          style={{ width: '100%', minHeight: 300 }}
        />
      )}

      {invalidMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <div>
            <p className="text-sm text-red-300">{invalidMsg}</p>
            {lastScanned && (
              <p className="text-xs text-neutral-500 mt-0.5">
                Scanned: <span className="font-mono">{lastScanned}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {!scanning && !loading && !savedSerial && (
        <button
          type="button"
          onClick={handleScanClick}
          className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-600 bg-neutral-900 py-8 hover:border-sky-500 hover:bg-neutral-800 active:bg-neutral-800/60 transition-colors"
        >
          <Scan className="h-8 w-8 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-300">
            {serialAttempts === 0 ? `Scan ${serialLabel}` : `Retry Scan`}
          </span>
        </button>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <p className="text-sm text-neutral-400">Saving…</p>
        </div>
      )}
    </div>
  );
}
