'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, Copy } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { EodSheetReviewer } from './EodSheetReviewer';
import { extractSheetFile, saveEodSheet } from '../../../services/eodBatchService';
import type { EodVlmExtraction, EodSavePayload, EodSlotStatus, EodSheetSlot } from '../../../types';

interface EodBatchQueueProps {
  files: File[];
  onAllDone: () => void;
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
  const extractingRef = useRef(false);
  const onAllDoneRef = useRef(onAllDone);
  useEffect(() => { onAllDoneRef.current = onAllDone; });

  useEffect(() => {
    if (extractingRef.current) return;
    const nextPending = slots.findIndex((s) => s.status === 'pending');
    if (nextPending === -1) return;
    extractingRef.current = true;
    setSlots((prev) => prev.map((s, i) => (i === nextPending ? { ...s, status: 'extracting' } : s)));
    extractSheetFile(slots[nextPending]!.file)
      .then((result) => {
        if (result.duplicate) {
          // Auto-skip — mark as duplicate and advance review index past this slot
          setSlots((prev) => prev.map((s, i) =>
            i === nextPending
              ? { ...s, status: 'duplicate', photoHash: result.photoHash, error: `Already uploaded on ${result.existingSheetDate}` }
              : s
          ));
        } else {
          setSlots((prev) => prev.map((s, i) =>
            i === nextPending ? { ...s, status: 'ready', extraction: result.extraction, photoHash: result.photoHash } : s
          ));
        }
      })
      .catch((err: unknown) => {
        setSlots((prev) => prev.map((s, i) =>
          i === nextPending ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Extraction failed' } : s
        ));
      })
      .finally(() => { extractingRef.current = false; });
  }, [slots]);

  // Auto-advance reviewIndex past duplicate/terminal slots
  useEffect(() => {
    const current = slots[reviewIndex];
    if (current && TERMINAL.includes(current.status) && current.status !== 'saved') {
      const next = slots.findIndex((s, i) => i > reviewIndex && !TERMINAL.includes(s.status));
      setReviewIndex(next === -1 ? reviewIndex + 1 : next);
    }
  }, [slots, reviewIndex]);

  useEffect(() => {
    if (slots.length > 0 && slots.every((s) => TERMINAL.includes(s.status))) onAllDoneRef.current();
  }, [slots]);

  const advanceReview = useCallback(() => {
    const next = slots.findIndex((s, i) => i > reviewIndex && !TERMINAL.includes(s.status));
    setReviewIndex(next === -1 ? reviewIndex + 1 : next);
    setSaveError(null);
  }, [slots, reviewIndex]);

  const handleSave = useCallback(async (payload: EodSavePayload) => {
    setSavingIndex(reviewIndex);
    setSaveError(null);
    const slot = slots[reviewIndex];
    try {
      const result = await saveEodSheet({ ...payload, photoHash: slot?.photoHash ?? null });
      setMatchedTotal((t) => t + (result.matched_count ?? 0));
      setSlots((prev) => prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'saved' } : s)));
      advanceReview();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingIndex(null);
    }
  }, [reviewIndex, advanceReview, slots]);

  const handleSkip = useCallback(() => {
    setSlots((prev) => prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'skipped' } : s)));
    advanceReview();
    setSaveError(null);
  }, [reviewIndex, advanceReview]);

  const handleRetry = useCallback((index: number) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, status: 'pending', error: null, photoHash: null } : s)));
  }, []);

  const currentSlot = slots[reviewIndex];
  const savedCount = slots.filter((s) => s.status === 'saved').length;
  const dupCount = slots.filter((s) => s.status === 'duplicate').length;
  const nonSkipped = slots.filter((s) => s.status !== 'skipped').length;

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

      {dupCount > 0 && (
        <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-400">
          {dupCount} sheet{dupCount !== 1 ? 's' : ''} already uploaded — skipped automatically.
        </div>
      )}

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
    </div>
  );
}
