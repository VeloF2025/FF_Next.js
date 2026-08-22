/**
 * Records why a pre-provision will never activate — the write side of the exit
 * path added in migration 524.
 *
 * A PP row could previously leave the open list only by activating, so faulty
 * ONTs and false positives accumulated on it indefinitely. That balance gates
 * Fibertime's ">100 open per POP, no new ports" rule, which is why classifying
 * one is operational work and not bookkeeping.
 *
 * UNDO IS PART OF THE FEATURE, not a nicety. The realistic workload is ~1,168
 * rows worked one at a time through this control, so a mis-click is the expected
 * failure mode rather than an edge case — and classifying removes the row from
 * the only queue that lists it. So the row stays visible in a `classified` state
 * with an Undo affordance until the list is next refetched, which is the window
 * in which someone notices they picked the wrong thing.
 */
import { useState } from 'react';

import { EXIT_REASON_LABELS, type PpExitReason } from './ppExitReasons';

interface Props {
  /** oes_pp_data.id */
  id: string;
  /** Called once the row is classified, so the caller can stop counting it. */
  onExited: (id: string) => void;
  /** Called when an exit is undone, so the caller can count it again. */
  onRestored: (id: string) => void;
}

export default function PpExitReasonSelect({ id, onExited, onRestored }: Props) {
  // '' means "still open". A controlled value (rather than defaultValue) is what
  // makes a retry possible: after a failed write the select is reset to '', so
  // re-picking the SAME reason still fires a change event. Left uncontrolled, the
  // DOM keeps the failed choice and no further event ever fires.
  const [value, setValue] = useState<'' | PpExitReason>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write(reason: PpExitReason | null) {
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
        // Surfaced beside the control and the value rolled back, so the row never
        // looks classified when the write did not land.
        setError(j.error?.message ?? 'Could not save');
        setValue(reason === null ? (value as PpExitReason) : '');
        return;
      }
      if (reason === null) {
        setValue('');
        onRestored(id);
      } else {
        setValue(reason);
        onExited(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setValue(reason === null ? (value as PpExitReason) : '');
    } finally {
      setSaving(false);
    }
  }

  if (value !== '') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] text-[var(--ff-text-tertiary)]">
          Exited · {EXIT_REASON_LABELS[value]}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => write(null)}
          className="text-[11px] text-blue-400 hover:underline disabled:opacity-50"
        >
          {saving ? 'Undoing…' : 'Undo'}
        </button>
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label="Exit reason"
        disabled={saving}
        value={value}
        onChange={(e) => {
          const next = e.target.value as PpExitReason;
          if (next) void write(next);
        }}
        className="text-[11px] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-1.5 py-1 text-[var(--ff-text-secondary)] disabled:opacity-50"
      >
        <option value="" disabled>
          {saving ? 'Saving…' : 'Exit reason…'}
        </option>
        {(Object.keys(EXIT_REASON_LABELS) as PpExitReason[]).map((v) => (
          <option key={v} value={v}>
            {EXIT_REASON_LABELS[v]}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-red-400 max-w-[12rem] text-right">{error}</span>}
    </div>
  );
}
