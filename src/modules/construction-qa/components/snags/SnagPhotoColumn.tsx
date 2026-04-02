/**
 * SnagPhotoColumn — Photo column for the 3-column before/during/after layout in SnagDetail.
 * Extracted to keep SnagDetail.tsx under 200 lines.
 */

'use client';

import { useState } from 'react';
import { Upload, ExternalLink } from 'lucide-react';
import type { SnagPhoto } from '../../types/snag.types';
import { uploadSnagPhoto } from '../../services/snagService';
import { log } from '@/lib/logger';

// ============================================================
// PhotoUrlInput
// ============================================================

function PhotoUrlInput({
  onSubmit,
  uploading,
}: {
  onSubmit: (url: string) => void;
  uploading: boolean;
}) {
  const [url, setUrl] = useState('');

  const handleSubmit = () => {
    if (url.trim()) {
      onSubmit(url);
      setUrl('');
    }
  };

  return (
    <div className="flex gap-1">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="VF Storage URL..."
        className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 min-w-0"
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={uploading || !url.trim()}
        className="flex items-center gap-1 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-2 py-1 rounded whitespace-nowrap"
      >
        <Upload className="h-3 w-3" />
        {uploading ? 'Adding...' : 'Add'}
      </button>
    </div>
  );
}

// ============================================================
// PhotoColumn (exported)
// ============================================================

interface PhotoColumnProps {
  phase: 'before' | 'during' | 'after';
  photos: SnagPhoto[];
  snagId: string;
  onPhotoAdded: (photo: SnagPhoto) => void;
}

/** 🟢 WORKING: Single phase column in the 3-column photo layout */
export function PhotoColumn({ phase, photos, snagId, onPhotoAdded }: PhotoColumnProps) {
  const [uploading, setUploading] = useState(false);
  const phasePhotos = photos.filter((p) => p.phase === phase);
  const canUpload = phase !== 'before';

  const handleUrlSubmit = async (url: string) => {
    if (!url.trim()) return;
    setUploading(true);
    try {
      const photo = await uploadSnagPhoto({
        snag_id: snagId,
        phase,
        photo_url: url.trim(),
        source: 'manual',
      });
      onPhotoAdded(photo);
    } catch (err) {
      log.error('Failed to add snag photo', { err });
    } finally {
      setUploading(false);
    }
  };

  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{phaseLabel}</h4>

      {phasePhotos.length > 0 ? (
        <div className="grid gap-1">
          {phasePhotos.map((photo) => (
            <a
              key={photo.id}
              href={photo.photo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block relative rounded overflow-hidden bg-zinc-800 hover:opacity-90 transition-opacity"
            >
              <img
                src={photo.thumbnail_url ?? photo.photo_url}
                alt={`${phaseLabel} photo`}
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-zinc-300 text-xs px-2 py-1 flex items-center justify-between">
                <span>{photo.source.replace('_', ' ')}</span>
                <ExternalLink className="h-3 w-3" />
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="h-32 rounded border border-dashed border-zinc-700 flex items-center justify-center text-zinc-600 text-xs">
          No {phase} photo
        </div>
      )}

      {canUpload && (
        <PhotoUrlInput onSubmit={handleUrlSubmit} uploading={uploading} />
      )}

      {canUpload && (
        <button
          type="button"
          disabled
          className="text-xs text-zinc-600 border border-zinc-700 rounded px-2 py-1 cursor-not-allowed"
          title="NOC import available in Phase 2"
        >
          Import from NOC (Phase 2)
        </button>
      )}
    </div>
  );
}
