/**
 * Incident Photo Upload - Evidence photo capture and display
 */

import React, { useRef } from 'react';
import { Camera, X, Upload } from 'lucide-react';
import { log } from '@/lib/logger';

export interface IncidentPhoto {
  url: string;
  caption?: string;
  timestamp: string;
}

interface IncidentPhotoUploadProps {
  photos: IncidentPhoto[];
  onPhotosChange: (photos: IncidentPhoto[]) => void;
  maxPhotos?: number;
}

export function IncidentPhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 10,
}: IncidentPhotoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = maxPhotos - photos.length;
    const toUpload = Array.from(files).slice(0, remaining);

    for (const file of toUpload) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'health-safety');
        formData.append('category', 'incidents');

        const res = await fetch('/api/storage/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });

        if (!res.ok) {
          log.error('Photo upload failed', { status: res.status });
          continue;
        }

        const data = await res.json();
        const newPhoto: IncidentPhoto = {
          url: data.data?.url || data.url,
          caption: '',
          timestamp: new Date().toISOString(),
        };
        onPhotosChange([...photos, newPhoto]);
      } catch (err) {
        log.error('Photo upload error', err as Error);
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (idx: number) => {
    onPhotosChange(photos.filter((_, i) => i !== idx));
  };

  const updateCaption = (idx: number, caption: string) => {
    onPhotosChange(photos.map((p, i) => (i === idx ? { ...p, caption } : p)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
          Evidence Photos ({photos.length}/{maxPhotos})
        </h3>
        {photos.length < maxPhotos && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)]"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Photos
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {photos.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full p-6 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg text-center hover:border-[var(--ff-primary-500)] transition-colors"
        >
          <Camera className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Click to upload evidence photos
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            JPG, PNG up to 10MB each
          </p>
        </button>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo, idx) => (
            <div
              key={idx}
              className="relative group rounded-lg overflow-hidden border border-[var(--ff-border-light)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.caption || `Evidence ${idx + 1}`}
                className="w-full h-24 object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
              <label htmlFor={`photo-caption-${idx}`} className="sr-only">
                Caption for photo {idx + 1}
              </label>
              <input
                id={`photo-caption-${idx}`}
                type="text"
                value={photo.caption || ''}
                onChange={(e) => updateCaption(idx, e.target.value)}
                placeholder="Caption..."
                aria-label={`Caption for photo ${idx + 1}`}
                className="w-full px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
