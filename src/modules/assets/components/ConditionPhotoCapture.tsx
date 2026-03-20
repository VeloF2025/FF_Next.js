'use client';

/**
 * ConditionPhotoCapture
 *
 * Reusable component for capturing condition/state photos of equipment.
 * Supports camera capture (rear-facing) and file upload.
 * Uploads to VF Storage under assets/condition-photos.
 *
 * Used in: AddAssetModal, CheckOutModal, CheckinModal
 *
 * A11y: WCAG 2.1 AA compliant (fixed 2026-03-20, PR #188 follow-up)
 * - Descriptive alt text with label + index context
 * - aria-label on zoom/remove/add buttons
 * - Lightbox: Escape key, focus trap, role=dialog, aria-modal, focus restore
 * - Loading state announced via aria-live region
 * - Decorative icons marked aria-hidden
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Loader2, ImagePlus, ZoomIn } from 'lucide-react';
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
  /** Label text — used in aria-labels and alt text for context */
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Refs for focus management
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const zoomButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const previewUrl = lightboxIndex !== null ? (photos[lightboxIndex]?.previewUrl ?? null) : null;

  // ── Focus Management: move focus into lightbox on open ──────────────────────
  useEffect(() => {
    if (lightboxIndex !== null && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [lightboxIndex]);

  // ── Keyboard support: Escape closes lightbox ────────────────────────────────
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex]);

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex((prev) => {
      // Restore focus to the zoom button that opened the lightbox
      if (prev !== null && zoomButtonRefs.current[prev]) {
        // Defer so state update completes before focus moves
        setTimeout(() => zoomButtonRefs.current[prev!]?.focus(), 0);
      }
      return null;
    });
  }, []);

  // ── Focus trap: keep Tab/Shift+Tab within lightbox ──────────────────────────
  const handleLightboxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
        return;
      }
      // Only the close button is focusable inside — trap Tab on it
      if (e.key === 'Tab') {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    },
    [closeLightbox]
  );

  const uploadPhoto = useCallback(
    async (dataUrl: string) => {
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

        const idx = updated.length - 1;
        const final = [...updated];
        final[idx] = { previewUrl: dataUrl, storageUrl: json.url, uploading: false };
        onChange(final);
      } catch (err) {
        log.error('Photo upload failed', { error: err }, 'ConditionPhotoCapture');
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
  const uploadingCount = photos.filter((p) => p.uploading).length;

  return (
    <div>
      {/* ── Screen-reader live region: announces upload progress ────────────── */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {uploadingCount > 0
          ? `Uploading ${uploadingCount} ${label.toLowerCase()} photo${uploadingCount > 1 ? 's' : ''}…`
          : ''}
      </div>

      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
        {label}{' '}
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          ({photos.length}/{maxPhotos})
        </span>
      </label>
      <p className="text-xs text-[var(--ff-text-tertiary)] mb-2">{helperText}</p>

      {/* ── Photo grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2" role="list" aria-label={`${label} thumbnails`}>
        {photos.map((photo, i) => (
          <div
            key={i}
            role="listitem"
            className="relative aspect-square bg-[var(--ff-bg-tertiary)] rounded-lg overflow-hidden group"
          >
            {/* Alt text: includes label + 1-based index for context */}
            <img
              src={photo.previewUrl}
              alt={`${label} — photo ${i + 1}${photo.uploading ? ' (uploading)' : ''}`}
              className="w-full h-full object-cover"
            />

            {/* ── Uploading overlay — announced via live region above ─────────── */}
            {photo.uploading && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center"
                aria-hidden="true"
              >
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}

            {!photo.uploading && (
              <>
                {/* ── Zoom button ──────────────────────────────────────────────── */}
                <button
                  ref={(el) => {
                    zoomButtonRefs.current[i] = el;
                  }}
                  type="button"
                  aria-label={`Zoom ${label} — photo ${i + 1}`}
                  onClick={() => openLightbox(i)}
                  className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:bg-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <ZoomIn className="h-5 w-5 text-white" aria-hidden="true" />
                </button>

                {/* ── Remove button ────────────────────────────────────────────── */}
                <button
                  type="button"
                  aria-label={`Remove ${label} — photo ${i + 1}`}
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <X className="h-3 w-3 text-white" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ))}

        {/* ── Add photo button ───────────────────────────────────────────────── */}
        {canAddMore && (
          <button
            type="button"
            aria-label={`Add ${label} photo (${photos.length} of ${maxPhotos} added)`}
            onClick={() => fileInputRef.current?.click()}
            className="aspect-square bg-[var(--ff-bg-tertiary)] border-2 border-dashed border-[var(--ff-border-light)] rounded-lg flex flex-col items-center justify-center gap-1 hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-accent)]"
          >
            <ImagePlus className="h-5 w-5 text-[var(--ff-text-tertiary)]" aria-hidden="true" />
            <span className="text-[10px] text-[var(--ff-text-tertiary)]" aria-hidden="true">
              Add Photo
            </span>
          </button>
        )}
      </div>

      {/* Hidden file input — not part of the accessibility tree */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* ── Lightbox ────────────────────────────────────────────────────────────
           role=dialog + aria-modal traps the accessibility tree.
           Keyboard: Escape closes; Tab kept within (only close button is focusable).
           Focus: moves to close button on open, returns to zoom trigger on close.
      ─────────────────────────────────────────────────────────────────────────── */}
      {previewUrl && lightboxIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${label} — photo ${lightboxIndex + 1} full-size preview`}
          className="fixed inset-0 z-[10001] bg-black/90 flex items-center justify-center p-4"
          onClick={closeLightbox}
          onKeyDown={handleLightboxKeyDown}
        >
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close photo preview"
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-6 w-6 text-white" aria-hidden="true" />
          </button>

          <img
            src={previewUrl}
            alt={`${label} — photo ${lightboxIndex + 1} full size`}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default ConditionPhotoCapture;
