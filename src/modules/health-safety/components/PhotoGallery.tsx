/**
 * Photo Gallery - Displays evidence photos from audits, incidents, or CAPA
 *
 * Renders a grid of photo thumbnails with captions. Clicking a photo
 * opens it in a lightbox overlay.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, ZoomIn, Camera, ChevronLeft, ChevronRight } from 'lucide-react';

export interface GalleryPhoto {
  url: string;
  caption?: string;
  timestamp?: string;
}

interface PhotoGalleryProps {
  photos: GalleryPhoto[];
  emptyMessage?: string;
  columns?: 2 | 3 | 4;
}

const GRID_COLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
} as const;

export function PhotoGallery({
  photos,
  emptyMessage = 'No photos available',
  columns = 3,
}: PhotoGalleryProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const closeLightbox = useCallback(() => setLightboxIdx(null), []);
  const prevPhoto = useCallback(() => {
    setLightboxIdx(prev => prev !== null ? (prev - 1 + photos.length) % photos.length : null);
  }, [photos.length]);
  const nextPhoto = useCallback(() => {
    setLightboxIdx(prev => prev !== null ? (prev + 1) % photos.length : null);
  }, [photos.length]);

  useEffect(() => {
    if (lightboxIdx === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIdx, closeLightbox, prevPhoto, nextPhoto]);

  if (!photos || photos.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-[var(--ff-text-tertiary)]">
        <Camera className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const current = lightboxIdx !== null ? photos[lightboxIdx] : null;

  return (
    <>
      <div className={`grid ${GRID_COLS[columns]} gap-3`}>
        {photos.map((photo, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setLightboxIdx(idx)}
            className="group relative rounded-lg overflow-hidden border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.caption || `Photo ${idx + 1}`}
              className="w-full h-28 object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {photo.caption && (
              <div className="px-2 py-1 bg-[var(--ff-bg-tertiary)] text-xs text-[var(--ff-text-secondary)] truncate">
                {photo.caption}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {current && lightboxIdx !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo lightbox: ${current.caption || `Photo ${lightboxIdx + 1} of ${photos.length}`}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closeLightbox}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeLightbox}
              aria-label="Close lightbox (Escape)"
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-white rounded"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>

            {/* Navigation */}
            {photos.length > 1 && (
              <div className="absolute top-1/2 -translate-y-1/2 -left-12 -right-12 flex justify-between pointer-events-none">
                <button
                  onClick={prevPhoto}
                  aria-label={`Previous photo (${(lightboxIdx - 1 + photos.length) % photos.length + 1} of ${photos.length})`}
                  className="pointer-events-auto p-2 text-white/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-white rounded"
                >
                  <ChevronLeft className="w-6 h-6" aria-hidden="true" />
                </button>
                <button
                  onClick={nextPhoto}
                  aria-label={`Next photo (${(lightboxIdx + 1) % photos.length + 1} of ${photos.length})`}
                  className="pointer-events-auto p-2 text-white/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-white rounded"
                >
                  <ChevronRight className="w-6 h-6" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.caption || `Photo ${lightboxIdx + 1} of ${photos.length}`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {current.caption && (
              <p className="text-center text-sm text-white/80 mt-3">{current.caption}</p>
            )}
            <p className="text-center text-xs text-white/50 mt-1" aria-live="polite">
              {lightboxIdx + 1} / {photos.length}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
