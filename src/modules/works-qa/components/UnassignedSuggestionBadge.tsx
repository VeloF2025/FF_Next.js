import { useState } from 'react';
import { log } from '@/lib/logger';

export interface UnassignedSuggestion {
  suggested_slot: string;
  confidence: number;
  generated_at?: string;
}

interface UnassignedSuggestionBadgeProps {
  poleId: string;
  photoKey: string;
  suggestion: UnassignedSuggestion;
  onAccepted: () => void | Promise<void>;
}

/**
 * Overlay badge on an unassigned photo thumbnail showing the AI's
 * predicted slot + confidence. Clicking [Accept] fires move-photo so
 * the photo lands in its slot and the user correction is logged for VLM
 * training. If the slot is already filled, move-photo will respond with
 * a slot-conflict error which surfaces in the toast.
 */
export function UnassignedSuggestionBadge({ poleId, photoKey, suggestion, onAccepted }: UnassignedSuggestionBadgeProps) {
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/works-qa/move-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pole_id: poleId,
          photo_key: photoKey,
          from: 'unassigned',
          to: suggestion.suggested_slot,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        log.error('works-qa: accept suggestion failed', { photoKey, slot: suggestion.suggested_slot, detail });
        return;
      }
      await onAccepted();
    } catch (err) {
      log.error('works-qa: accept suggestion threw', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round(suggestion.confidence * 100);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/80 text-white px-1 py-0.5 flex items-center justify-between gap-1">
      <span className="text-[9px] truncate" title={`→ ${suggestion.suggested_slot}`}>
        → {suggestion.suggested_slot} · {pct}%
      </span>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="text-[9px] px-1 py-0.5 rounded bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-600 transition-colors"
      >
        {busy ? '…' : 'Accept'}
      </button>
    </div>
  );
}
