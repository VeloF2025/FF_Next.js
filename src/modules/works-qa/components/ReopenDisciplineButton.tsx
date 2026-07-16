import { useState } from 'react';
import { reopenDiscipline } from '../utils/pole-detail-api';
import type { Discipline } from '../utils/approval-gates';

interface ReopenDisciplineButtonProps {
  poleId: string;
  discipline: Discipline;
  label: string;
  onReopened: () => void;
}

/**
 * "Re-open" control shown on an approved discipline. Reverts the discipline's
 * approval (via /api/works-qa/pole-reopen) so its photos can be removed,
 * replaced or re-shot — the field case being poles that physically shift on
 * site after sign-off (Johan, WA 2026-07-16).
 *
 * Kept as its own component so ApproveDisciplineButton stays under the
 * 200-line component limit. Confirmation is required because re-opening
 * reverses an approval.
 */
export function ReopenDisciplineButton({ poleId, discipline, label, onReopened }: ReopenDisciplineButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doReopen() {
    setReopening(true);
    setError(null);
    try {
      await reopenDiscipline(poleId, discipline);
      setConfirming(false);
      onReopened();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-open failed');
    } finally {
      setReopening(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[10px] text-zinc-400 hover:text-amber-300 underline"
        title="Re-open this discipline to remove or replace photos"
      >
        Re-open
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2 rounded bg-amber-500/5 border border-amber-500/40">
      <p className="text-[10px] text-amber-300">
        Re-open {label}? It will no longer be marked approved, so photos can be removed or replaced.
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void doReopen()}
          disabled={reopening}
          className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-2 py-1"
        >
          {reopening ? 'Re-opening…' : 'Yes, re-open'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={reopening}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
