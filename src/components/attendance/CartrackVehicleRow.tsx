/**
 * One row of the Cartrack mapping table (/staff/attendance/cartrack-mapping).
 *
 * Extracted from the page so the page stays under the 300-line file cap.
 * Stateless — all state (draft value, busy, override) lives in the page and
 * is passed down via props; the row just renders and raises callbacks.
 */

import { Save, X } from 'lucide-react';

export interface FleetVehicle {
  id: string;
  registration: string | null;
  description: string | null;
  cartrack_vehicle_id: string | null;
}

export interface Candidate {
  cartrackId: string;
  registration: string | null;
  description: string | null;
}

interface Props {
  vehicle: FleetVehicle;
  suggestions: Candidate[];
  draftValue: string | undefined;
  busy: boolean;
  /** True when the API last returned 503 for this row (Cartrack unreachable). */
  showOverride: boolean;
  onPickCandidate: (cartrackId: string) => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onSaveOverride: () => void;
  onCancel: () => void;
}

export function CartrackVehicleRow({
  vehicle: v,
  suggestions,
  draftValue,
  busy,
  showOverride,
  onPickCandidate,
  onDraftChange,
  onSave,
  onSaveOverride,
  onCancel,
}: Props) {
  const dirty = draftValue !== undefined;
  return (
    <tr className="border-t border-neutral-800 align-top">
      <td className="px-3 py-2 font-medium">{v.registration ?? '—'}</td>
      <td className="px-3 py-2 text-neutral-400">{v.description ?? '—'}</td>
      <td className="px-3 py-2 text-xs font-mono">
        {v.cartrack_vehicle_id ?? <span className="text-neutral-500">—</span>}
      </td>
      <td className="px-3 py-2">
        {suggestions.length === 0 ? (
          <span className="text-xs text-neutral-500">(none)</span>
        ) : (
          <ul className="text-xs space-y-1">
            {suggestions.map((c) => (
              <li key={c.cartrackId}>
                <button
                  type="button"
                  onClick={() => onPickCandidate(c.cartrackId)}
                  className="font-mono text-emerald-400 hover:underline"
                >
                  {c.cartrackId}
                </button>
                {c.description && (
                  <span className="text-neutral-500"> · {c.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={draftValue ?? v.cartrack_vehicle_id ?? ''}
          placeholder="Cartrack ID or blank to clear"
          onChange={(e) => onDraftChange(e.target.value)}
          className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs font-mono w-40"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={onSave}
            className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> Save
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={onCancel}
            className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 disabled:opacity-50 text-xs flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
          {showOverride && (
            <button
              type="button"
              disabled={busy}
              onClick={onSaveOverride}
              className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700 hover:bg-amber-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
            >
              Save without validation
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
