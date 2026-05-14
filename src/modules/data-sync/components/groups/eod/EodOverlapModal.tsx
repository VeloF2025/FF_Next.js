'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { EodOverlapMatch } from '../../../types';

interface EodOverlapModalProps {
  matches: EodOverlapMatch[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function EodOverlapModal({ matches, saving, onCancel, onConfirm }: EodOverlapModalProps) {
  const totalDrs = matches.reduce((sum, m) => sum + m.overlapping_drs.length, 0);
  const totalOnts = matches.reduce((sum, m) => sum + m.overlapping_onts.length, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="eod-overlap-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl bg-[var(--ff-bg-secondary)] border border-amber-500/30 rounded-xl shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--ff-border-light)] bg-amber-500/10">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 id="eod-overlap-modal-title" className="text-sm font-semibold">Possible duplicate sheet</h2>
          </div>
          <button onClick={onCancel} className="text-[var(--ff-text-secondary)] hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            This sheet contains{' '}
            {totalDrs > 0 && <strong className="text-white">{totalDrs} DR number{totalDrs !== 1 ? 's' : ''}</strong>}
            {totalDrs > 0 && totalOnts > 0 && ' and '}
            {totalOnts > 0 && <strong className="text-white">{totalOnts} ONT serial{totalOnts !== 1 ? 's' : ''}</strong>}
            {' '}that already exist in previous sheets.
            This usually means the sheet has been uploaded before, or that some of the same drops
            were recorded again (continuation of an incomplete sheet).
          </p>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--ff-border-light)] divide-y divide-[var(--ff-border-light)]">
            {matches.map((m) => (
              <div key={m.sheet_id} className="px-3 py-2.5 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--ff-text-secondary)]">
                  <span>
                    Sheet from <strong className="text-white">{m.sheet_date}</strong>
                    {m.technician_name ? ` — ${m.technician_name}` : ''}
                    {m.uploaded_by ? ` (uploaded by ${m.uploaded_by})` : ''}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ff-text-tertiary)]">{m.sheet_id.slice(0, 8)}</span>
                </div>
                {m.overlapping_drs.length > 0 && (
                  <div className="text-[var(--ff-text-tertiary)]">
                    DRs:{' '}
                    <span className="text-amber-300">
                      {m.overlapping_drs.slice(0, 8).join(', ')}
                      {m.overlapping_drs.length > 8 ? ` + ${m.overlapping_drs.length - 8} more` : ''}
                    </span>
                  </div>
                )}
                {m.overlapping_onts.length > 0 && (
                  <div className="text-[var(--ff-text-tertiary)]">
                    ONTs:{' '}
                    <span className="text-amber-300">
                      {m.overlapping_onts.slice(0, 4).join(', ')}
                      {m.overlapping_onts.length > 4 ? ` + ${m.overlapping_onts.length - 4} more` : ''}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save anyway'}
          </button>
        </footer>
      </div>
    </div>
  );
}
