'use client';

/**
 * ReturnSignSubmitStep — final step of the /my/stores/return flow.
 *
 * Signature + notes + offline-tolerant submit.
 * Mirrors SignAndSubmitStep but:
 *  - Uses PwaReturnDraft / submitReturn / enqueueReturn (not issue equivalents)
 *  - No ValueCapPanel (returns have no R5k cap)
 *  - Idempotency key generated once per component mount (React.useMemo)
 */

import { useState, useCallback, useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import { submitReturn, ApiError } from '@/modules/field-stock-pwa/api';
import { enqueueReturn } from '@/modules/field-stock-pwa/offline/queueReturn';
import { RETURN_REASONS } from '@/modules/field-stock-pwa/lib/returnReasons';
import type { ReturnReason } from '@/modules/field-stock-pwa/lib/returnReasons';
import type {
  PwaMyHeldSerial,
  PwaReturnDraft,
  PwaReturnResult,
} from '@/modules/field-stock-pwa/types';

// =============================================================================
// Props
// =============================================================================

export interface ReturnSignSubmitStepProps {
  reason: ReturnReason;
  serials: PwaMyHeldSerial[];
  returnToLocationId: string;
  returnToLocationName: string;
  originalPickingId: string | null;
  onSubmitted: (result: PwaReturnResult) => void;
  onBack: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ReturnSignSubmitStep({
  reason,
  serials,
  returnToLocationId,
  returnToLocationName,
  originalPickingId,
  onSubmitted,
  onBack,
}: ReturnSignSubmitStepProps) {
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable per component mount — re-submits reuse the same key so the server dedupes.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const reasonLabel =
    RETURN_REASONS.find((r) => r.code === reason)?.label ?? reason;

  const canSubmit = signatureDataUrl !== null && serials.length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const draft: PwaReturnDraft = {
      reason,
      reasonNotes: null,
      serials,
      signatureDataUrl,
      returnToLocationId,
      originalPickingId,
      notes,
    };

    try {
      if (navigator.onLine) {
        const result = await submitReturn(draft, idempotencyKey);
        onSubmitted(result);
      } else {
        const queueId = await enqueueReturn(draft);
        onSubmitted({
          returnId: 'queued-' + queueId,
          returnNumber: 'QUEUED',
          status: 'pending',
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'An unexpected error occurred. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, reason, serials, signatureDataUrl, returnToLocationId,
    originalPickingId, notes, idempotencyKey, onSubmitted,
  ]);

  return (
    <div className="space-y-4">
      {/* Summary panel */}
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 space-y-1">
        <span className="text-xs text-neutral-400">Return summary</span>
        <p className="text-sm text-white font-medium">
          {serials.length} serial{serials.length !== 1 ? 's' : ''} —{' '}
          <span className="text-emerald-300">{reasonLabel}</span>
        </p>
        <p className="text-sm text-neutral-300">
          Returning to{' '}
          <span className="font-medium text-white">{returnToLocationName}</span>
        </p>

        {/* Serial list */}
        {serials.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {serials.map((s) => (
              <li key={s.serialId} className="text-xs text-neutral-400 font-mono">
                {s.serialNumber}
                <span className="ml-1 text-neutral-600 font-sans">{s.stockItemName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Technician signature */}
      <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />

      {/* Optional notes */}
      <div className="space-y-1.5">
        <label htmlFor="return-notes" className="text-sm font-medium text-neutral-300">
          Notes
          <span className="ml-1 text-xs text-neutral-600 font-normal">(optional)</span>
        </label>
        <textarea
          id="return-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Any notes for the stores record…"
          className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm placeholder:text-neutral-600 px-3 py-2.5 focus:outline-none focus:border-neutral-500 resize-none"
        />
        <p className="text-right text-xs text-neutral-600">{notes.length}/500</p>
      </div>

      {/* Inline error */}
      {error && (
        <div className="flex gap-2 rounded-lg bg-rose-950/60 border border-rose-800 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      {/* Action row */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3.5 rounded-lg border border-neutral-700 text-neutral-300 text-sm font-medium hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-[2] py-3.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting…
            </>
          ) : (
            'Sign and submit'
          )}
        </button>
      </div>
    </div>
  );
}
