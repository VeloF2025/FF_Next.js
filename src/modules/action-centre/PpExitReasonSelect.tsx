/**
 * Records why a pre-provision will never activate — the write side of the exit
 * path added in migration 524.
 *
 * A PP row could previously leave the open list only by activating, so faulty
 * ONTs and false positives accumulated on it indefinitely. That balance gates
 * Fibertime's ">100 open per POP, no new ports" rule, which is why classifying
 * one is operational work and not bookkeeping.
 *
 * Choosing a reason removes the row from the queue immediately (`onExited`),
 * because the queue lists open work and this row is no longer open. That is
 * also the confirmation — the row leaving IS the feedback.
 */
import { useState } from 'react';

import { EXIT_REASON_LABELS } from './ppExitReasons';



interface Props {
  /** oes_pp_data.id */
  id: string;
  /** Called after the row has been classified, so the caller can drop it. */
  onExited: (id: string) => void;
}

export default function PpExitReasonSelect({ id, onExited }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(reason: string) {
    if (!reason || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-exit-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(id), exit_reason: reason }),
      });
      const j = await res.json();
      if (!j.success) {
        // Surfaced next to the control rather than swallowed: a failed write
        // that looks like a success would leave the row on the list while the
        // operator believes it is classified.
        setError(j.error?.message ?? 'Could not save');
        return;
      }
      onExited(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label="Exit reason"
        disabled={saving}
        defaultValue=""
        onChange={(e) => choose(e.target.value)}
        className="text-[11px] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-1.5 py-1 text-[var(--ff-text-secondary)] disabled:opacity-50"
      >
        <option value="" disabled>
          {saving ? 'Saving…' : 'Exit reason…'}
        </option>
        {Object.entries(EXIT_REASON_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-red-400 max-w-[12rem] text-right">{error}</span>}
    </div>
  );
}
