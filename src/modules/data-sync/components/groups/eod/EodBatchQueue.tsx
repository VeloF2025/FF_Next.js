'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { EodSheetReviewer } from './EodSheetReviewer';
import type { EodVlmExtraction, EodSavePayload } from '../../../types';

type SlotStatus = 'pending' | 'extracting' | 'ready' | 'saving' | 'saved' | 'failed' | 'skipped';

interface SheetSlot {
  file: File;
  status: SlotStatus;
  extraction: EodVlmExtraction | null;
  error: string | null;
}

interface EodBatchQueueProps {
  files: File[];
  onAllDone: () => void;
}

async function extractFile(file: File): Promise<EodVlmExtraction> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/eod/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  const json = await res.json() as { success: boolean; data: EodVlmExtraction; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Extraction failed');
  return json.data;
}

async function saveSheet(payload: EodSavePayload): Promise<{ matched_count: number }> {
  const res = await fetch('/api/eod/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetDate: payload.sheetDate,
      technicianName: payload.technicianName,
      technicianId: payload.technicianId,
      entries: payload.entries.map((e) => ({
        row_number: e.row_number,
        ont_serial: e.ont_serial,
        gizzu_serial: e.gizzu_serial,
        dr_number: e.dr_number,
        pon_number: e.pon_number,
        address: e.address,
      })),
    }),
  });
  const json = await res.json() as { success: boolean; data: { matched_count: number }; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Save failed');
  return json.data;
}

const STATUS_COLORS: Record<SlotStatus, string> = {
  pending: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
  extracting: 'bg-blue-500/20 text-blue-400',
  ready: 'bg-amber-500/20 text-amber-400',
  saving: 'bg-blue-500/20 text-blue-400',
  saved: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  skipped: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] line-through',
};

export function EodBatchQueue({ files, onAllDone }: EodBatchQueueProps) {
  const [slots, setSlots] = useState<SheetSlot[]>(() =>
    files.map((file) => ({ file, status: 'pending', extraction: null, error: null }))
  );
  const [reviewIndex, setReviewIndex] = useState(0);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const extractingRef = useRef(false);
  const onAllDoneRef = useRef(onAllDone);
  useEffect(() => { onAllDoneRef.current = onAllDone; });

  // Pipeline: keep exactly one slot extracting at a time
  useEffect(() => {
    if (extractingRef.current) return;
    const nextPending = slots.findIndex((s) => s.status === 'pending');
    if (nextPending === -1) return;

    extractingRef.current = true;
    setSlots((prev) =>
      prev.map((s, i) => (i === nextPending ? { ...s, status: 'extracting' } : s))
    );

    extractFile(slots[nextPending]!.file)
      .then((extraction) => {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === nextPending ? { ...s, status: 'ready', extraction } : s
          )
        );
      })
      .catch((err: unknown) => {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === nextPending
              ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Extraction failed' }
              : s
          )
        );
      })
      .finally(() => {
        extractingRef.current = false;
      });
  }, [slots]);

  // Check if all done — fires exactly once via stable ref
  useEffect(() => {
    const allSettled = slots.every((s) =>
      s.status === 'saved' || s.status === 'skipped' || s.status === 'failed'
    );
    if (allSettled && slots.length > 0) onAllDoneRef.current();
  }, [slots]);

  const advanceReview = useCallback(() => {
    const next = slots.findIndex(
      (s, i) => i > reviewIndex && s.status !== 'saved' && s.status !== 'skipped'
    );
    setReviewIndex(next === -1 ? reviewIndex + 1 : next);
    setSaveError(null);
  }, [slots, reviewIndex]);

  const handleSave = useCallback(
    async (payload: EodSavePayload) => {
      setSavingIndex(reviewIndex);
      setSaveError(null);
      try {
        const result = await saveSheet(payload);
        setMatchedTotal((t) => t + (result.matched_count ?? 0));
        setSlots((prev) =>
          prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'saved' } : s))
        );
        advanceReview();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSavingIndex(null);
      }
    },
    [reviewIndex, advanceReview]
  );

  const handleSkip = useCallback(() => {
    setSlots((prev) =>
      prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'skipped' } : s))
    );
    advanceReview();
    setSaveError(null);
  }, [reviewIndex, advanceReview]);

  const handleRetry = useCallback((index: number) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, status: 'pending', error: null } : s))
    );
  }, []);

  const currentSlot = slots[reviewIndex];
  const savedCount = slots.filter((s) => s.status === 'saved').length;
  const totalNonSkipped = slots.filter((s) => s.status !== 'skipped').length;

  return (
    <div className="space-y-6">
      {/* Progress chips */}
      <div className="flex flex-wrap gap-2">
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${STATUS_COLORS[slot.status]} ${i === reviewIndex ? 'ring-1 ring-[var(--ff-accent)]' : ''}`}
          >
            {slot.status === 'extracting' && <InlineSpinner size="sm" />}
            {slot.status === 'saved' && <CheckCircle className="w-3 h-3" />}
            {slot.status === 'failed' && <AlertCircle className="w-3 h-3" />}
            <span>{slot.file.name.replace(/\.[^.]+$/, '').slice(0, 20)}</span>
            {slot.status === 'failed' && (
              <button
                onClick={() => handleRetry(i)}
                className="ml-1 hover:text-white"
                title="Retry extraction"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Matched count banner */}
      {matchedTotal > 0 && (
        <div className="px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
          {matchedTotal} DR↔ONT {matchedTotal === 1 ? 'match' : 'matches'} written to records
        </div>
      )}

      {/* Current sheet review */}
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
          <button
            onClick={() => handleRetry(reviewIndex)}
            className="text-xs text-red-400 border border-red-500/30 px-3 py-1.5 rounded hover:bg-red-500/10"
          >
            Retry
          </button>
          <button
            onClick={handleSkip}
            className="text-xs text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] px-3 py-1.5 rounded hover:bg-[var(--ff-bg-secondary)]"
          >
            Skip
          </button>
        </div>
      )}

      {/* All done summary */}
      {slots.every((s) => ['saved', 'skipped', 'failed'].includes(s.status)) && (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {savedCount} of {totalNonSkipped} sheets saved.
            {matchedTotal > 0 && ` ${matchedTotal} DR↔ONT matches recorded.`}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Check the Reconciliation tab to compare with WA DRs and OES activations.
          </p>
        </div>
      )}
    </div>
  );
}
