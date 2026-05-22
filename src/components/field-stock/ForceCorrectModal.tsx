/**
 * ForceCorrectModal — single-serial force-correct modal for the serial detail page.
 * Extracted to keep [serialNumber].tsx under 300 lines.
 */

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ForceCorrectFields, type ForceCorrectCurrentValues } from './ForceCorrectFields';
import type { ForceCorrectTarget, ForceCorrectResult } from '@/types/field-stock';

export function ForceCorrectModal({
  serialNumber,
  currentValues,
  onClose,
  onSuccess,
}: {
  serialNumber: string;
  currentValues: ForceCorrectCurrentValues;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fcTarget, setFcTarget] = useState<ForceCorrectTarget>({});
  const [fcReason, setFcReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const hasFields = Object.values(fcTarget).some((v) => v !== undefined);
  const reasonOk = fcReason.trim().length >= 10;
  const canApply = hasFields && reasonOk && !submitting;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleApply() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/procurement/field-stock/serials/force-correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          serials: [serialNumber],
          target: fcTarget,
          reason: fcReason,
          dryRun: false,
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: ForceCorrectResult;
        error?: { message?: string };
      };
      if (!json.success) {
        toast.error(json.error?.message ?? 'Force-correct failed');
        return;
      }
      const result = json.data!;
      if (result.totalApplied > 0) {
        toast.success(`Force-correct applied to ${serialNumber}`);
        onSuccess();
      } else {
        const row = result.rows[0];
        const note = row?.error ?? (row?.found ? 'No fields changed (no-op)' : 'Serial not found');
        toast.error(note);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-xl shadow-2xl bg-[var(--ff-surface-primary)] border border-[var(--ff-border-primary)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--ff-border-primary)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">
            Force-correct — <span className="font-mono">{serialNumber}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-border-subtle)] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <ForceCorrectFields
            value={fcTarget}
            reason={fcReason}
            onChange={setFcTarget}
            onReasonChange={setFcReason}
            currentValues={currentValues}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-[var(--ff-border-primary)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-[var(--ff-border-subtle)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-border-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
