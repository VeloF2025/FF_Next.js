'use client';

/**
 * ConditionPhotoCapture
 *
 * Reusable component for capturing condition/state photos of equipment.
 * Supports camera capture (rear-facing) and file upload.
 * Uploads to VF Storage under assets/condition-photos.
 *
 * Used in: AddAssetModal, CheckOutModal, CheckinModal
 */

import { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Loader2, ImagePlus, ZoomIn } from 'lucide-react';
import { log } from '@/lib/logger';

export interface CapturedPhoto {
  /** Preview data URL (for display before/during upload) */
  previewUrl: string;
  /** VF Storage URL after upload */
  storageUrl?: string;
  /** Whether upload is in progress */
  uploading: boolean;
}

interface ConditionPhotoCaptureProps {
  /** Current photos */
  photos: CapturedPhoto[];
  /** Update photos */
  onChange: (photos: CapturedPhoto[]) => void;
  /** Storage category prefix, e.g. "condition-photos" or "checkout-photos" */
  storageCategory?: string;
  /** Max number of photos */
  maxPhotos?: number;
  /** Label text */
  label?: string;
  /** Helper text */
  helperText?: string;
}

/** Compress image to max dimension and JPEG quality */
function compressImage(dataUrl: string, maxDim = 1280, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export function ConditionPhotoCapture({
  photos,
  onChange,
  storageCategory = 'condition-photos',
  maxPhotos = 4,
  label = 'Condition Photos',
  helperText = 'Take photos of the equipment condition',
}: ConditionPhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const uploadPhoto = useCallback(
    async (dataUrl: string) => {
      // Add photo with preview immediately
      const newPhoto: CapturedPhoto = { previewUrl: dataUrl, uploading: true };
      const updated = [...photos, newPhoto];
      onChange(updated);

      try {
        const blob = await compressImage(dataUrl);
        const file = new File([blob], `asset_condition_${Date.now()}.jpg`, { type: 'image/jpeg' });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'assets');
        formData.append('category', storageCategory);

        const res = await fetch('/api/storage/upload', { method: 'POST', body: formData });
        const json = await res.json();

        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Upload failed');
        }

        // Update photo with storage URL
        const idx = updated.length - 1;
        const final = [...updated];
        final[idx] = { previewUrl: dataUrl, storageUrl: json.url, uploading: false };
        onChange(final);
      } catch (err) {
        log.error('Photo upload failed', { error: err }, 'ConditionPhotoCapture');
        // Remove failed photo
        onChange(updated.filter((_, i) => i !== updated.length - 1));
      }
    },
    [photos, onChange, storageCategory]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) uploadPhoto(dataUrl);
      };
      reader.readAsDataURL(file);

      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [uploadPhoto]
  );

  const removePhoto = useCallback(
    (index: number) => {
      onChange(photos.filter((_, i) => i !== index));
    },
    [photos, onChange]
  );

  const canAddMore = photos.length < maxPhotos;

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
        {label} <span className="text-xs text-[var(--ff-text-tertiary)]">({photos.length}/{maxPhotos})</span>
      </label>
      <p className="text-xs text-[var(--ff-text-tertiary)] mb-2">{helperText}</p>

      {/* Photo grid */}
      <div className="grid grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <div key={i} className="relative aspect-square bg-[var(--ff-bg-tertiary)] rounded-lg overflow-hidden group">
            <img src={photo.previewUrl} alt={`Condition ${i + 1}`} className="w-full h-full object-cover" />
            {photo.uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}
            {!photo.uploading && (
              <>
                <button
                  type="button"
                  onClick={() => setPreviewUrl(photo.previewUrl)}
                  className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
                >
                  <ZoomIn className="h-5 w-5 text-white" />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </>
            )}
          </div>
        ))}

        {/* Add button */}
        {canAddMore && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="aspect-square bg-[var(--ff-bg-tertiary)] border-2 border-dashed border-[var(--ff-border-light)] rounded-lg flex flex-col items-center justify-center gap-1 hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors"
          >
            <ImagePlus className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
            <span className="text-[10px] text-[var(--ff-text-tertiary)]">Add Photo</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Lightbox preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[10001] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full"
            onClick={() => setPreviewUrl(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default ConditionPhotoCapture;
