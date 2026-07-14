// src/modules/sitecam/components/SerialScanCards.tsx
// Presentational result cards for SerialScanStep, split out to keep the scan
// component under the component-size limit.
import { CheckCircle, Clock, Loader2, Scan } from 'lucide-react';

type CrossRefStatus = 'verified' | 'mismatch' | 'pending';

/**
 * Review-and-confirm gate shown after a serial is scanned or typed. Nothing is
 * saved until the technician taps Confirm — a mis-read barcode can be rejected
 * with Rescan / Edit before it is committed.
 */
export function SerialConfirmCard({
  serialLabel,
  serial,
  positionLabel,
  loading,
  onConfirm,
  onRescan,
}: {
  serialLabel: string;
  serial: string;
  positionLabel: string | null;
  loading: boolean;
  onConfirm: () => void;
  onRescan: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-sky-800 bg-sky-950/30 px-4 py-6">
      {positionLabel && (
        <p className="text-center text-xs font-medium uppercase tracking-wide text-sky-300">{positionLabel}</p>
      )}
      <p className="text-center text-sm font-medium text-neutral-200">Is this {serialLabel} correct?</p>
      <p className="break-all text-center font-mono text-2xl font-semibold text-neutral-100">{serial}</p>
      <p className="text-center text-xs text-neutral-500">Check it matches the sticker before confirming.</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={loading}
          onClick={onRescan}
          className="flex items-center justify-center gap-2 rounded-lg border border-neutral-600 py-3 text-sm font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          <Scan className="h-4 w-4" /> Rescan / Edit
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={onConfirm}
          className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle className="h-4 w-4" /> Confirm</>}
        </button>
      </div>
    </div>
  );
}

const TONES: Record<CrossRefStatus, { border: string; bg: string; text: string; icon: string }> = {
  verified: { border: 'border-green-800', bg: 'bg-green-950/40', text: 'text-green-300', icon: 'text-green-400' },
  mismatch: { border: 'border-amber-800', bg: 'bg-amber-950/40', text: 'text-amber-300', icon: 'text-amber-400' },
  pending: { border: 'border-sky-800', bg: 'bg-sky-950/40', text: 'text-sky-300', icon: 'text-sky-400' },
};

/** Confirmation card shown once a serial has been saved to the server. */
export function SerialSavedCard({
  serial,
  crossRefStatus,
  message,
}: {
  serial: string;
  crossRefStatus: CrossRefStatus | null;
  message: string | null;
}) {
  const tone = TONES[crossRefStatus ?? 'pending'];
  return (
    <div className={`flex flex-col items-center gap-3 rounded-xl border ${tone.border} ${tone.bg} py-8 px-4`}>
      {crossRefStatus === 'verified' ? (
        <CheckCircle className={`h-8 w-8 ${tone.icon}`} />
      ) : (
        <Clock className={`h-8 w-8 ${tone.icon}`} />
      )}
      <p className={`text-sm font-medium ${tone.text}`}>Serial saved — {serial}</p>
      <p className="text-center text-xs text-neutral-500">{message ?? 'Cross-reference pending (1Map + OES)'}</p>
    </div>
  );
}
