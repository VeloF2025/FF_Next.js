import { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { UnassignedThumb } from './UnassignedThumb';

interface DeletedBucketProps {
  photoKeys: string[];
  onRestore: (photoKey: string) => void;
}

/**
 * Recycle bin for photos removed from the Unassigned bucket. Soft-deleted, not
 * dropped — the underlying MinIO blob is untouched — so a mis-delete is
 * recoverable via Restore (moves the key back to unassigned_photo_keys).
 *
 * Collapsed by default and hidden entirely when empty, so it declutters the
 * Unassigned grid rather than adding a second always-on grid ("otherwise it
 * gets too messy" — Johan, WA 2026-07-16).
 */
export function DeletedBucket({ photoKeys, onRestore }: DeletedBucketProps) {
  const [open, setOpen] = useState(false);

  // Nothing binned → render nothing. The section only appears once there is
  // something to recover, keeping the panel clean.
  if (photoKeys.length === 0) return null;

  return (
    <section className="border border-zinc-800 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown
            className={`w-4 h-4 text-zinc-500 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`}
          />
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider truncate">
            Deleted Photos ({photoKeys.length})
          </h3>
        </div>
        <span className="text-[10px] text-zinc-600 shrink-0">recoverable</span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800">
          <div className="grid grid-cols-4 gap-1">
            {photoKeys.map((key, i) => (
              <div
                key={key}
                className="relative rounded overflow-hidden group opacity-70 hover:opacity-100 transition-opacity"
              >
                <UnassignedThumb photoKey={key} index={i} />
                <button
                  type="button"
                  onClick={() => onRestore(key)}
                  aria-label="Restore photo to unassigned"
                  title="Restore to Unassigned"
                  className="absolute top-1 right-1 z-10 p-0.5 rounded bg-black/70 text-zinc-200 hover:text-teal-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
