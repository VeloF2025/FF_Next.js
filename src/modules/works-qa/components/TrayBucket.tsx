import { useState } from 'react';
import { log } from '@/lib/logger';
import { photoUrl } from '../utils/photo-url';

interface TrayBucketProps {
  trayKeys: string[];
  onUpload: (files: File[]) => void;
  onView?: (index: number) => void;
  disabled?: boolean;
}

export function TrayBucket({ trayKeys, onUpload, onView, disabled }: TrayBucketProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Tray Photos ({trayKeys.length})
        </span>
        <label
          className={`text-xs ${
            disabled
              ? 'opacity-50 cursor-not-allowed text-zinc-600'
              : 'text-teal-400 hover:text-teal-300 cursor-pointer'
          }`}
        >
          + Add
          {/* `sr-only` (not `hidden`): see PhotoSlotCard.tsx — Chromium won't
              open the file picker for display:none inputs. */}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onUpload(files);
              e.target.value = '';
              log.debug('works-qa: tray files picked', { count: files.length });
            }}
          />
        </label>
      </div>

      <div
        onDragOver={e => {
          if (disabled) return;
          e.preventDefault();
          if (!isDragOver) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => {
          if (disabled) return;
          e.preventDefault();
          setIsDragOver(false);
          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
          if (files.length > 0) onUpload(files);
          log.debug('works-qa: tray drop', { droppedCount: files.length });
        }}
        className={`rounded-lg p-3 min-h-16 border transition-colors ${
          isDragOver
            ? 'border-teal-500 border-solid bg-teal-500/10'
            : 'border-dashed border-zinc-700'
        }`}
      >
        {trayKeys.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center pt-2">Drop tray photos here or click Add</p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {trayKeys.map((key, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onView?.(i)}
                disabled={!onView}
                className="w-full h-16 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-default"
                aria-label={`Open tray photo ${i + 1}`}
              >
                <img
                  src={photoUrl(key)}
                  alt={`Tray ${i + 1}`}
                  className="w-full h-full object-cover transition-transform hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
