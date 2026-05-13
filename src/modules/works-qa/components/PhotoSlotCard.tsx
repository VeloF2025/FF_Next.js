import { useState, useRef } from 'react';
import type { VlmSlotResult } from '../types/works-qa.types';
import { photoUrl } from '../utils/photo-url';

interface PhotoSlotCardProps {
  slotKey: string;
  label: string;
  photoKey: string | null;
  vlm: VlmSlotResult | undefined;
  onUpload: (file: File) => void;
  onOverride: (decision: 'pass' | 'fail', reason: string) => void;
  onView?: () => void;
  disabled?: boolean;
}

export function PhotoSlotCard({ slotKey: _slotKey, label, photoKey, vlm, onUpload, onOverride, onView, disabled }: PhotoSlotCardProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const status: 'empty' | 'pass' | 'fail' | 'overridden' =
    !photoKey ? 'empty'
    : vlm?.overridden_by ? 'overridden'
    : vlm?.valid ? 'pass'
    : vlm ? 'fail'
    : 'empty';

  const borderColor =
    status === 'pass' ? 'border-green-500/40' :
    status === 'overridden' ? 'border-amber-500/40' :
    status === 'fail' ? 'border-red-500/40' :
    'border-zinc-700 border-dashed';

  const bgColor =
    status === 'pass' ? 'bg-green-500/5' :
    status === 'overridden' ? 'bg-amber-500/5' :
    status === 'fail' ? 'bg-red-500/5' :
    'bg-zinc-900';

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {status === 'pass' && <span className="text-xs text-green-400">✓ VLM pass</span>}
        {status === 'overridden' && <span className="text-xs text-amber-400">✓ Overridden</span>}
        {status === 'fail' && <span className="text-xs text-red-400">⚠ VLM fail</span>}
      </div>

      {photoKey ? (
        <button
          type="button"
          onClick={onView}
          disabled={!onView}
          className="w-full h-28 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-default"
          aria-label={`Open ${label}`}
        >
          <img
            src={photoUrl(photoKey)}
            alt={label}
            className="w-full h-full object-cover transition-transform hover:scale-[1.02]"
          />
        </button>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="w-full h-28 flex items-center justify-center text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50"
        >
          + Upload
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />

      {vlm?.feedback && (
        <p className="text-xs text-zinc-500 leading-tight">{vlm.feedback}</p>
      )}

      {status === 'fail' && !showOverride && (
        <button
          onClick={() => setShowOverride(true)}
          className="text-xs text-amber-400 hover:text-amber-300 underline self-start"
        >
          Override
        </button>
      )}

      {showOverride && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            placeholder="Override reason…"
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
          />
          <div className="flex gap-1">
            <button
              onClick={() => { onOverride('pass', overrideReason); setShowOverride(false); }}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1"
            >
              Mark Pass
            </button>
            <button
              onClick={() => setShowOverride(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
