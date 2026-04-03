/**
 * SnagPhotoColumn — Photo column for the 3-column before/during/after layout in SnagDetail.
 * Supports file upload (drag-and-drop or click), URL input fallback, and photo delete.
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, ExternalLink, Link as LinkIcon, X, Loader2 } from 'lucide-react';
import type { SnagPhoto } from '../../types/snag.types';
import { uploadSnagPhoto, uploadSnagPhotoFile, deleteSnagPhoto } from '../../services/snagService';
import { log } from '@/lib/logger';

// ============================================================
// FileUploadZone
// ============================================================

interface FileUploadZoneProps {
  onFile: (file: File) => void;
  uploading: boolean;
}

function FileUploadZone({ onFile, uploading }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) onFile(file);
  }, [onFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // Reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  }, [onFile]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload photo"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      className={`flex flex-col items-center justify-center gap-1 py-2 rounded border border-dashed cursor-pointer transition-colors text-xs select-none
        ${dragOver ? 'border-blue-500 bg-blue-950/30 text-blue-300' : 'border-zinc-600 hover:border-zinc-400 text-zinc-400'}`}
    >
      {uploading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Upload className="h-4 w-4" />
      )}
      <span>{uploading ? 'Uploading...' : 'Upload photo'}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
        disabled={uploading}
      />
    </div>
  );
}

// ============================================================
// PhotoUrlInput (secondary/collapsed)
// ============================================================

interface PhotoUrlInputProps {
  onSubmit: (url: string) => void;
  uploading: boolean;
}

function PhotoUrlInput({ onSubmit, uploading }: PhotoUrlInputProps) {
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <LinkIcon className="h-3 w-3" />
        Add by URL
      </button>
    );
  }

  const handleSubmit = () => {
    if (url.trim()) {
      onSubmit(url.trim());
      setUrl('');
      setOpen(false);
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
        autoFocus
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={uploading || !url.trim()}
        className="flex items-center gap-1 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-2 py-1 rounded whitespace-nowrap"
      >
        {uploading ? 'Adding...' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setUrl(''); }}
        className="text-zinc-500 hover:text-zinc-300 px-1"
        aria-label="Cancel URL input"
      >
        <X className="h-3 w-3" />
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
  onPhotoDeleted: (photoId: string) => void;
}

/** 🟢 WORKING: Single phase column in the 3-column photo layout */
export function PhotoColumn({ phase, photos, snagId, onPhotoAdded, onPhotoDeleted }: PhotoColumnProps) {
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const phasePhotos = photos.filter((p) => p.phase === phase);
  const canUpload = phase !== 'before';
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const photo = await uploadSnagPhotoFile(file, snagId, phase);
      onPhotoAdded(photo);
    } catch (err) {
      log.error('Failed to upload snag photo file', { err, snagId, phase });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlSubmit = async (url: string) => {
    setUploading(true);
    try {
      const photo = await uploadSnagPhoto({
        snag_id: snagId,
        phase,
        photo_url: url,
        source: 'manual',
      });
      onPhotoAdded(photo);
    } catch (err) {
      log.error('Failed to add snag photo by URL', { err, snagId, phase });
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    const confirmed = window.confirm('Delete this photo? This cannot be undone.');
    if (!confirmed) return;
    setDeletingId(photoId);
    try {
      await deleteSnagPhoto(photoId);
      onPhotoDeleted(photoId);
    } catch (err) {
      log.error('Failed to delete snag photo', { err, photoId });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{phaseLabel}</h4>

      {phasePhotos.length > 0 ? (
        <div className="grid gap-1">
          {phasePhotos.map((photo) => (
            <div key={photo.id} className="relative group rounded overflow-hidden bg-zinc-800">
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

              {/* Delete overlay button */}
              <button
                type="button"
                onClick={() => { void handleDeletePhoto(photo.id); }}
                disabled={deletingId === photo.id}
                title="Delete photo"
                aria-label="Delete photo"
                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
              >
                {deletingId === photo.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-32 rounded border border-dashed border-zinc-700 flex items-center justify-center text-zinc-600 text-xs">
          No {phase} photo
        </div>
      )}

      {canUpload && (
        <FileUploadZone onFile={handleFileUpload} uploading={uploading} />
      )}

      {canUpload && (
        <PhotoUrlInput onSubmit={handleUrlSubmit} uploading={uploading} />
      )}
    </div>
  );
}
