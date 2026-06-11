import { useState } from 'react';
import { X } from 'lucide-react';
import { photoUrl } from '../utils/photo-url';
import type { LinkCandidate } from '../utils/link-candidates';

interface Props {
  targetLabel: string;
  candidates: LinkCandidate[];
  onSelect: (sourceSlot: string, reason: string) => void;
  onClose: () => void;
}

/**
 * Pick an existing photo on this pole to reuse for another step (e.g. a depth
 * shot that also shows the end-plates, or a wide pole shot that evidences both
 * the dome and the main-joint closure). Candidates span ALL disciplines, so each
 * thumbnail is tagged with its discipline. Selection marks the target slot as a
 * dual-step override.
 */
export function SlotPhotoPicker({ targetLabel, candidates, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-100">
            Reuse a photo for <span className="text-teal-400">{targetLabel}</span>
          </span>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          {candidates.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">
              No other photos on this pole to reuse yet.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500 mb-2">
                Pick the photo that also shows {targetLabel.toLowerCase()}:
              </p>
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {candidates.map(c => (
                  <button
                    key={c.slotKey}
                    type="button"
                    onClick={() => setSelected(c.slotKey)}
                    className={`rounded overflow-hidden border-2 transition-colors ${
                      selected === c.slotKey ? 'border-teal-400' : 'border-transparent hover:border-zinc-600'
                    }`}
                  >
                    <img src={photoUrl(c.photoKey)} alt={c.label} className="w-full h-20 object-cover" />
                    <span className="block text-[10px] uppercase tracking-wide text-teal-500/80 px-1 pt-0.5 truncate">{c.disciplineLabel}</span>
                    <span className="block text-[10px] text-zinc-400 px-1 pb-0.5 truncate">{c.label}</span>
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Reason (optional)…"
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="mt-3 w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => { if (selected) onSelect(selected, reason); }}
                  className="text-xs px-3 py-1.5 rounded bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40"
                >
                  Use this photo
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
