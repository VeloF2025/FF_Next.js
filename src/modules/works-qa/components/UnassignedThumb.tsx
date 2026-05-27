import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { photoUrl } from '../utils/photo-url';

interface UnassignedThumbProps {
  photoKey: string;
  index: number;
  onView?: (index: number) => void;
}

/**
 * Single thumbnail in the Unassigned Photos bucket. Handles broken-image
 * cases (MinIO blob deleted, SharePoint cookie expired, etc.) by rendering
 * a "Photo unavailable" placeholder instead of the browser's default
 * broken-image icon + alt-text label.
 *
 * The DB still references these dead photo keys, so the bucket count
 * remains accurate — the user can drag them out / accept suggestions /
 * future Remove-broken action will splice them from the array.
 */
export function UnassignedThumb({ photoKey, index, onView }: UnassignedThumbProps) {
  const [broken, setBroken] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onView?.(index)}
      disabled={!onView}
      className="block w-full h-16 focus:outline-none focus:ring-2 focus:ring-teal-500"
      aria-label={broken ? 'Unavailable photo' : 'Open unassigned photo'}
      title={broken ? `Photo unavailable in storage: ${photoKey}` : undefined}
    >
      {broken ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800/60 border border-zinc-700/60 text-zinc-500">
          <ImageOff className="w-4 h-4 mb-0.5" aria-hidden="true" />
          <span className="text-[9px] leading-tight">unavailable</span>
        </div>
      ) : (
        <img
          src={photoUrl(photoKey)}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
    </button>
  );
}
