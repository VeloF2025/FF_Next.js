/**
 * Crew member rows for the crew-lead check-in.
 *
 * Each row is one worker: a name (always), an optional link to a registered
 * team member, and fitness. Fitness defaults to fit and the lead UNTICKS it —
 * matching the API, where an omitted fit_for_duty means fit. The checkbox
 * still always submits a real boolean; the default only sets its initial state.
 *
 * Picking a registered worker fills the name and locks it, so the stored
 * worker_name can never quietly diverge from the person the id points to.
 */

import { X } from 'lucide-react';
import { CHECKIN_CARD } from './CheckinPrompts';

export interface RosterMember {
  id: string;
  name: string;
  contractor_id: string | null;
}

export interface CrewRowValue {
  key: number;
  name: string;
  teamMemberId: string | null;
  fit: boolean;
}

const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

export function CrewRows({
  rows,
  roster,
  onChange,
}: {
  rows: CrewRowValue[];
  /** Registered workers selectable for the chosen contractor. */
  roster: RosterMember[];
  onChange: (rows: CrewRowValue[]) => void;
}) {
  const usedIds = new Set(rows.map((r) => r.teamMemberId).filter(Boolean));

  function update(key: number, patch: Partial<CrewRowValue>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function pickMember(row: CrewRowValue, id: string) {
    if (!id) {
      update(row.key, { teamMemberId: null });
      return;
    }
    const member = roster.find((m) => m.id === id);
    update(row.key, { teamMemberId: id, name: member?.name ?? row.name });
  }

  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div key={row.key} className={CHECKIN_CARD}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              Crew member {idx + 1}
            </span>
            {rows.length > 1 && (
              <button
                type="button"
                aria-label={`Remove crew member ${idx + 1}`}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                className="text-neutral-500 hover:text-red-400"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <input
            type="text"
            className={inputCls}
            placeholder="Full name"
            aria-label={`Name of crew member ${idx + 1}`}
            value={row.name}
            readOnly={row.teamMemberId != null}
            onChange={(e) => update(row.key, { name: e.target.value })}
          />

          {roster.length > 0 && (
            <select
              className={`${inputCls} mt-2`}
              aria-label={`Registered worker for crew member ${idx + 1}`}
              value={row.teamMemberId ?? ''}
              onChange={(e) => pickMember(row, e.target.value)}
            >
              <option value="">Not in the register (name only)</option>
              {roster
                .filter((m) => m.id === row.teamMemberId || !usedIds.has(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          )}

          <label className="mt-3 flex items-center gap-3 text-sm text-neutral-200">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={row.fit}
              onChange={(e) => update(row.key, { fit: e.target.checked })}
            />
            Fit for duty today
          </label>
          {!row.fit && (
            <p className="mt-2 text-sm text-amber-300">
              They will not be cleared to start, and the H&amp;S officer will be notified.
              Their pay is not affected.
            </p>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { key: Math.max(0, ...rows.map((r) => r.key)) + 1, name: '', teamMemberId: null, fit: true },
          ])
        }
        className="w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 rounded-lg text-sm"
      >
        + Add crew member
      </button>
    </div>
  );
}
