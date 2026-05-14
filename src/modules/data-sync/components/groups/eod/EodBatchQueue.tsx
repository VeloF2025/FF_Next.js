'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, Copy } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { EodSheetReviewer } from './EodSheetReviewer';
import { EodOverlapModal } from './EodOverlapModal';
import { EodDuplicateBanner } from './EodDuplicateBanner';
import {
  extractSheetFile,
  saveEodSheet,
  EodOverlapError,
} from '../../../services/eodBatchService';
import type { EodSavePayload, EodSlotStatus, EodSheetSlot, EodOverlapMatch } from '../../../types';

interface EodBatchQueueProps {
  files: File[];
  onAllDone: (savedSlots: EodSheetSlot[]) => void;
}

const SLOT_COLOR: Record<EodSlotStatus, string> = {
  pending:    'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
  extracting: 'bg-blue-500/20 text-blue-400',
  ready:      'bg-amber-500/20 text-amber-400',
  saving:     'bg-blue-500/20 text-blue-400',
  saved:      'bg-green-500/20 text-green-400',
  failed:     'bg-red-500/20 text-red-400',
  skipped:    'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] line-through',
  duplicate:  'bg-amber-500/10 text-amber-500/70 line-through',
};

const TERMINAL: EodSlotStatus[] = ['saved', 'skipped', 'failed', 'duplicate'];

export function EodBatchQueue({ files, onAllDone }: EodBatchQueueProps) {
  const [slots, setSlots] = useState<EodSheetSlot[]>(() =>
    files.map((file) => ({ file, status: 'pending', extraction: null, photoHash: null, error: null }))
  );
  const [reviewIndex, setReviewIndex] = useState(0);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [overlap, setOverlap] = useState<{ matches: EodOverlapMatch[]; payload: EodSavePayload; index: number } | null>(null);
  const extractingRef = useRef(false);
  const onAllDoneRef = useRef(onAllDone);
  useEffect(() => { onAllDoneRef.current = onAllDone; });

  useEffect(() => {
    if (extractingRef.current) return;
    const nextPending = slots.findIndex((s) => s.status === 'pending');
    if (nextPending === -1) return;
    extractingRef.current = true;
    setSlots((prev) => prev.map((s, i) => (i === nextPending ? { ...s, status: 'extracting' } : s)));
    const slot = slots[nextPending]!;
    extractSheetFile(slot.file, { skipHashCheck: slot.forceReExtract === true })
      .then((result) => {
        if (result.duplicate) {
          // Auto-skip — mark as duplicate and advance review index past this slot
          setSlots((prev) => prev.map((s, i) =>
            i === nextPending
              ? { ...s, status: 'duplicate', photoHash: result.photoHash, error: `Already uploaded on ${result.existingSheetDate}`, forceReExtract: false }
              : s
          ));
        } else {
          setSlots((prev) => prev.map((s, i) =>
            i === nextPending ? { ...s, status: 'ready', extraction: result.extraction, photoHash: result.photoHash, forceReExtract: false } : s
          ));
        }
      })
      .catch((err: unknown) => {
        setSlots((prev) => prev.map((s, i) =>
          i === nextPending ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Extraction failed', forceReExtract: false } : s
        ));
      })
      .finally(() => { extractingRef.current = false; });
  }, [slots]);

  // Auto-advance reviewIndex past duplicate/skipped — NOT past failed (user must retry or skip)
  useEffect(() => {
    const current = slots[reviewIndex];
    if (current && TERMINAL.includes(current.status) && current.status !== 'saved' && current.status !== 'failed') {
      const next = slots.findIndex((s, i) => i > reviewIndex && !TERMINAL.includes(s.status));
      setReviewIndex(Math.min(next === -1 ? reviewIndex + 1 : next, slots.length));
    }
  }, [slots, reviewIndex]);

  // Only complete the batch when every slot is fully resolved.
  // `duplicate` is held open: the user must explicitly Re-extract or Dismiss
  // so the dup banner stays visible. `failed` is held open for the same reason
  // (retry vs skip is a user decision).
  useEffect(() => {
    if (slots.length > 0
      && slots.every((s) => TERMINAL.includes(s.status))
      && !slots.some((s) => s.status === 'failed' || s.status === 'duplicate')) {
      onAllDoneRef.current(slots.filter((s) => s.status === 'saved'));
    }
  }, [slots]);

  /** Bulk-dismiss all remaining duplicate slots so the batch can finalize. */
  const handleDismissDuplicates = useCallback(() => {
    setSlots((prev) => prev.map((s) => (s.status === 'duplicate' ? { ...s, status: 'skipped' } : s)));
  }, []);

  const advanceReview = useCallback(() => {
    const next = slots.findIndex((s, i) => i > reviewIndex && !TERMINAL.includes(s.status));
    setReviewIndex(next === -1 ? reviewIndex + 1 : next);
    setSaveError(null);
  }, [slots, reviewIndex]);

  const performSave = useCallback(async (
    payload: EodSavePayload,
    index: number,
    options: { forceOverlap?: boolean } = {},
  ) => {
    setSavingIndex(index);
    setSaveError(null);
    try {
      const result = await saveEodSheet(payload, options);
      setMatchedTotal((t) => t + (result.matched_count ?? 0));
      setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, status: 'saved' } : s)));
      setOverlap(null);
      advanceReview();
    } catch (err) {
      if (err instanceof EodOverlapError) {
        setOverlap({ matches: err.overlaps, payload, index });
      } else {
        setSaveError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSavingIndex(null);
    }
  }, [advanceReview]);

  const handleSave = useCallback(async (payload: EodSavePayload) => {
    const slot = slots[reviewIndex];
    await performSave({ ...payload, photoHash: slot?.photoHash ?? null }, reviewIndex);
  }, [reviewIndex, performSave, slots]);

  const handleSkip = useCallback(() => {
    setSlots((prev) => prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'skipped' } : s)));
    advanceReview();
    setSaveError(null);
  }, [reviewIndex, advanceReview]);

  const handleRetry = useCallback((index: number) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, status: 'pending', error: null, photoHash: null } : s)));
  }, []);

  /**
   * Re-extract a slot that was flagged as a duplicate image. Sets
   * forceReExtract=true so the next extract call omits photoHash from the
   * request, bypassing the API's image-hash dedup so the VLM runs fresh.
   */
  const handleForceReExtract = useCallback((index: number) => {
    setSlots((prev) => prev.map((s, i) =>
      i === index ? { ...s, status: 'pending', error: null, photoHash: null, forceReExtract: true } : s
    ));
    setReviewIndex((idx) => Math.min(idx, index));
  }, []);

  const handleOverlapCancel = useCallback(() => {
    setOverlap(null);
  }, []);

  const handleOverlapConfirm = useCallback(() => {
    if (!overlap) return;
    void performSave(overlap.payload, overlap.index, { forceOverlap: true });
  }, [overlap, performSave]);

  const currentSlot = slots[reviewIndex];
  const savedCount = slots.filter((s) => s.status === 'saved').length;
  const dupCount = slots.filter((s) => s.status === 'duplicate').length;
  // Exclude skipped and duplicate from the denominator — "X of Y saved" should only count actionable sheets
  const nonSkipped = slots.filter((s) => s.status !== 'skipped' && s.status !== 'duplicate').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${SLOT_COLOR[slot.status]} ${i === reviewIndex ? 'ring-1 ring-[var(--ff-accent)]' : ''}`}
            title={slot.status === 'duplicate' ? slot.error ?? 'Duplicate' : undefined}
          >
            {slot.status === 'extracting' && <InlineSpinner size="sm" />}
            {slot.status === 'saved' && <CheckCircle className="w-3 h-3" />}
            {slot.status === 'failed' && <AlertCircle className="w-3 h-3" />}
            {slot.status === 'duplicate' && <Copy className="w-3 h-3" />}
            <span>{slot.file.name.replace(/\.[^.]+$/, '').slice(0, 20)}</span>
            {slot.status === 'failed' && (
              <button onClick={() => handleRetry(i)} className="ml-1 hover:text-white" title="Retry">
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <EodDuplicateBanner
        slots={slots}
        onForceReExtract={handleForceReExtract}
        onDismissAll={handleDismissDuplicates}
      />

      {matchedTotal > 0 && (
        <div className="px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
          {matchedTotal} DR↔ONT {matchedTotal === 1 ? 'match' : 'matches'} written to records
        </div>
      )}

      {currentSlot?.status === 'ready' && currentSlot.extraction && (
        <EodSheetReviewer
          key={reviewIndex}
          extraction={currentSlot.extraction}
          sheetIndex={reviewIndex}
          totalSheets={slots.length}
          saving={savingIndex === reviewIndex}
          error={saveError}
          onSave={handleSave}
          onSkip={handleSkip}
        />
      )}

      {currentSlot?.status === 'extracting' && (
        <div className="flex items-center gap-3 py-8 justify-center text-[var(--ff-text-secondary)]">
          <InlineSpinner size="sm" />
          <span>Extracting sheet {reviewIndex + 1} of {slots.length}…</span>
        </div>
      )}

      {currentSlot?.status === 'failed' && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-400 font-medium">Extraction failed for {currentSlot.file.name}</p>
            {currentSlot.error && <p className="text-xs text-[var(--ff-text-secondary)] mt-1">{currentSlot.error}</p>}
          </div>
          <button onClick={() => handleRetry(reviewIndex)} className="text-xs text-red-400 border border-red-500/30 px-3 py-1.5 rounded hover:bg-red-500/10">Retry</button>
          <button onClick={handleSkip} className="text-xs text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] px-3 py-1.5 rounded hover:bg-[var(--ff-bg-secondary)]">Skip</button>
        </div>
      )}

      {slots.every((s) => TERMINAL.includes(s.status)) && (
        <div className="text-center py-4 text-sm text-[var(--ff-text-secondary)]">
          {savedCount} of {nonSkipped} sheets saved.
          {matchedTotal > 0 && ` ${matchedTotal} DR↔ONT matches recorded.`}
          {dupCount > 0 && ` ${dupCount} duplicate${dupCount !== 1 ? 's' : ''} skipped.`}
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Check the Reconciliation tab to compare with WA DRs and OES activations.</p>
        </div>
      )}

      {overlap && (
        <EodOverlapModal
          matches={overlap.matches}
          saving={savingIndex !== null}
          onCancel={handleOverlapCancel}
          onConfirm={handleOverlapConfirm}
        />
      )}
    </div>
  );
}
