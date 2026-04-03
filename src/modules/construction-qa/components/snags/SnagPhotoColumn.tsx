/**
 * SnagPhotoColumn — Photo column for the 3-column before/during/after layout.
 * - Before column: read-only (imported from TQR PDF)
 * - During/After: file upload (primary) + URL input (secondary toggle)
 * - All photos: hover X button to delete
 */

'use client';

import { useState, useRef } from 'react';
import { Upload, ExternalLink, X, Link as LinkIcon, Loader2, MapPin } from 'lucide-react';
import type { SnagPhoto } from '../../types/snag.types';
import { uploadSnagPhoto, uploadSnagPhotoFile, deleteSnagPhoto } from '../../services/snagService';
import { log } from '@/lib/logger';

// ============================================================
// PhotoUrlInput — secondary URL add mode
// ============================================================

function PhotoUrlInput({
  onSubmit,
  uploading,
  onCancel,
}: {
  onSubmit: (url: string) => void;
  uploading: boolean;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');

  const handleSubmit = () => {
    if (url.trim()) {
      onSubmit(url);
      setUrl('');
    }
  };

  return (
    <div className="flex flex-col gap-1">
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
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? 'Adding...' : 'Add'}
        </button>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-zinc-500 hover:text-zinc-300 text-left"
      >
        Cancel
      </button>
    </div>
  );
}

// ============================================================
// PhotoThumbnail — single photo with delete overlay
// ============================================================

function PhotoThumbnail({
  photo,
  phaseLabel,
  onDelete,
}: {
  photo: SnagPhoto;
  phaseLabel: string;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this photo?')) return;
    setDeleting(true);
    try {
      await deleteSnagPhoto(photo.id);
      onDelete(photo.id);
    } catch (err) {
      log.error('Failed to delete snag photo', { err, photoId: photo.id });
    } finally {
      setDeleting(false);
    }
  };

  const hasGps = photo.latitude != null && photo.longitude != null;
  const mapsUrl = hasGps
    ? `https://www.google.com/maps?q=${photo.latitude},${photo.longitude}`
    : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative group rounded overflow-hidden bg-zinc-800">
        <a
          href={photo.photo_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:opacity-90 transition-opacity"
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

        {/* Delete button — visible on hover */}
        <button
          type="button"
          onClick={(e) => { void handleDelete(e); }}
          disabled={deleting}
          aria-label="Delete photo"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-red-800 disabled:opacity-50 rounded p-0.5"
        >
          {deleting
            ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
            : <X className="h-3.5 w-3.5 text-white" />
          }
        </button>
      </div>

      {/* Pole reference and GPS metadata */}
      {(photo.pole_reference ?? mapsUrl) && (
        <div className="flex flex-col gap-0.5 px-0.5">
          {photo.pole_reference && (
            <span className="text-xs text-zinc-400 truncate">{photo.pole_reference}</span>
          )}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 truncate"
            >
              <MapPin className="h-3 w-3 shrink-0" />
              {photo.latitude?.toFixed(5)}, {photo.longitude?.toFixed(5)}
            </a>
          )}
        </div>
      )}
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
  onPhotoDeleted: (photoId: string) => void;
}

/** 🟢 WORKING: Single phase column — file upload + URL add + photo delete */
export function PhotoColumn({
  phase,
  photos,
  snagId,
  onPhotoAdded,
  onPhotoDeleted,
}: PhotoColumnProps) {
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const phasePhotos = photos.filter((p) => p.phase === phase);
  const canUpload = phase !== 'before';
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

  // ── File upload ─────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
    setUploading(true);
    try {
      const photo = await uploadSnagPhotoFile(file, snagId, phase);
      onPhotoAdded(photo);
    } catch (err) {
      log.error('Failed to upload fix photo', { err, snagId, phase });
    } finally {
      setUploading(false);
    }
  };

  // ── URL submit ──────────────────────────────────────────

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
      setShowUrlInput(false);
    } catch (err) {
      log.error('Failed to add snag photo by URL', { err });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{phaseLabel}</h4>

      {/* Photo list */}
      {phasePhotos.length > 0 ? (
        <div className="grid gap-1">
          {phasePhotos.map((photo) => (
            <PhotoThumbnail
              key={photo.id}
              photo={photo}
              phaseLabel={phaseLabel}
              onDelete={onPhotoDeleted}
            />
          ))}
        </div>
      ) : (
        <div className="h-32 rounded border border-dashed border-zinc-700 flex items-center justify-center text-zinc-600 text-xs">
          No {phase} photo
        </div>
      )}

      {/* Upload controls (during / after only) */}
      {canUpload && (
        <>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { void handleFileChange(e); }}
          />

          {/* Primary: file upload button */}
          {!showUrlInput && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-2 py-1.5 rounded w-full"
            >
              {uploading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Upload className="h-3 w-3" />
              }
              {uploading ? 'Uploading...' : 'Upload photo'}
            </button>
          )}

          {/* Secondary: URL input toggle */}
          {!showUrlInput ? (
            <button
              type="button"
              onClick={() => setShowUrlInput(true)}
              disabled={uploading}
              className="flex items-center justify-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            >
              <LinkIcon className="h-3 w-3" />
              Add by URL
            </button>
          ) : (
            <PhotoUrlInput
              onSubmit={handleUrlSubmit}
              uploading={uploading}
              onCancel={() => setShowUrlInput(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
