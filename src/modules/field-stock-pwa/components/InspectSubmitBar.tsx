'use client';

/**
 * InspectSubmitBar — signature pad + inspection notes + submit button for
 * the /my/stores/inspect/[id] screen.
 *
 * Extracted from InspectOrchestrator to keep that file under 200 lines.
 */

import { Loader2, AlertTriangle, RefreshCcw } from 'lucide-react';
import { SignaturePad } from './SignaturePad';

// =============================================================================
// Props
// =============================================================================

export interface InspectSubmitBarProps {
  /** Overall inspection notes (one textarea for the whole return). */
  inspectionNotes: string;
  onNotesChange: (notes: string) => void;
  signatureDataUrl: string | null;
  onSignatureChange: (dataUrl: string | null) => void;
  /** True when every line has condition + disposition set. */
  linesComplete: boolean;
  /** Whether the return is in 'inspected' status (retry-accept path). */
  isRetryPath: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function InspectSubmitBar({
  inspectionNotes,
  onNotesChange,
  signatureDataUrl,
  onSignatureChange,
  linesComplete,
  isRetryPath,
  submitting,
  error,
  onSubmit,
}: InspectSubmitBarProps) {
  const canSubmit =
    !submitting &&
    (isRetryPath || (linesComplete && signatureDataUrl !== null));

  return (
    <div className="space-y-4 pt-2">
      {/* Inspection notes — not shown on retry path (dispositions already locked) */}
      {!isRetryPath && (
        <div className="space-y-1.5">
          <label htmlFor="inspection-notes" className="text-sm font-medium text-neutral-300">
            Inspection notes
            <span className="ml-1 text-xs text-neutral-600 font-normal">(optional)</span>
          </label>
          <textarea
            id="inspection-notes"
            value={inspectionNotes}
            onChange={(e) => onNotesChange(e.target.value.slice(0, 1000))}
            maxLength={1000}
            rows={3}
            placeholder="Overall inspection notes for the return record…"
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm placeholder:text-neutral-600 px-3 py-2.5 focus:outline-none focus:border-neutral-500 resize-none"
          />
          <p className="text-right text-xs text-neutral-600">{inspectionNotes.length}/1000</p>
        </div>
      )}

      {/* Signature — not needed on retry path */}
      {!isRetryPath && (
        <SignaturePad value={signatureDataUrl} onChange={onSignatureChange} />
      )}

      {/* Inline error */}
      {error && (
        <div className="flex gap-2 rounded-lg bg-rose-950/60 border border-rose-800 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      {/* Submit button */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full py-3.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing…
          </>
        ) : isRetryPath ? (
          <>
            <RefreshCcw className="w-4 h-4" />
            Retry restock
          </>
        ) : (
          'Inspect and restock'
        )}
      </button>

      {!isRetryPath && !linesComplete && (
        <p className="text-xs text-center text-neutral-500">
          Set condition and disposition on every line to enable submit
        </p>
      )}
      {!isRetryPath && linesComplete && !signatureDataUrl && (
        <p className="text-xs text-center text-neutral-500">
          Sign above to enable submit
        </p>
      )}
    </div>
  );
}
