/**
 * Photo Gallery Component
 * Displays DR installation photos in a responsive grid
 * Supports click-to-enlarge lightbox view
 */

'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PhotoGalleryProps } from '../types';

export function PhotoGallery({ photos, dr_number }: PhotoGalleryProps) {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => {
    setSelectedPhotoIndex(index);
  };

  const closeLightbox = () => {
    setSelectedPhotoIndex(null);
  };

  const goToNext = () => {
    if (selectedPhotoIndex !== null && selectedPhotoIndex < photos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  const goToPrevious = () => {
    if (selectedPhotoIndex !== null && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') goToNext();
    if (e.key === 'ArrowLeft') goToPrevious();
  };

  if (photos.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-[var(--ff-bg-tertiary)] rounded-lg border-2 border-dashed border-[var(--ff-border-light)]">
        <div className="text-center">
          <p className="text-[var(--ff-text-secondary)] text-lg">No photos available for {dr_number}</p>
          <p className="text-[var(--ff-text-tertiary)] text-sm mt-2">Photos will appear here once uploaded</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Photo Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" role="list" aria-label="Installation photos">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            className="relative aspect-square bg-[var(--ff-bg-tertiary)] rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all group"
            onClick={() => openLightbox(index)}
            title={`${photo.stepLabel}\n${photo.filename}\n${photo.timestamp ? new Date(photo.timestamp).toLocaleString() : 'No timestamp'}`}
            aria-label={`View ${photo.stepLabel} - ${photo.filename}`}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.stepLabel}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2" aria-hidden="true">
              <p className="text-white text-xs font-medium truncate">{photo.stepLabel}</p>
            </div>

            {/* Hover Tooltip */}
            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-4 pointer-events-none" aria-hidden="true">
              <div className="text-white text-center space-y-1">
                <p className="text-sm font-semibold">{photo.stepLabel}</p>
                <p className="text-xs text-[var(--ff-text-tertiary)] break-all">{photo.filename}</p>
                {photo.timestamp && (
                  <p className="text-xs text-[var(--ff-text-tertiary)]">
                    {new Date(photo.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox Modal */}
      {selectedPhotoIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
          onClick={closeLightbox}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
        >
          {/* Close Button - Prominent with background */}
          <button
            className="absolute top-4 right-4 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-3 transition-all hover:scale-110 active:scale-95"
            onClick={closeLightbox}
            aria-label="Close lightbox"
          >
            <X size={28} />
          </button>

          {/* Previous Button - More prominent with background circle */}
          {selectedPhotoIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-4 transition-all hover:scale-110 active:scale-95 shadow-lg"
              onClick={(e) => {
                e.stopPropagation();
                goToPrevious();
              }}
              aria-label="Previous photo"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          {/* Next Button - More prominent with background circle */}
          {selectedPhotoIndex < photos.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-4 transition-all hover:scale-110 active:scale-95 shadow-lg"
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              aria-label="Next photo"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {/* Photo Display */}
          <div
            className="relative max-w-5xl max-h-[90vh] w-full h-full flex flex-col items-center justify-center p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full h-full flex items-center justify-center">
              {photos[selectedPhotoIndex] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photos[selectedPhotoIndex].url}
                  alt={photos[selectedPhotoIndex].stepLabel}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>

            {/* Photo Info */}
            {photos[selectedPhotoIndex] && (
              <div className="mt-4 text-center text-white">
                <p className="text-lg font-semibold">{photos[selectedPhotoIndex].stepLabel}</p>
                <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                  {selectedPhotoIndex + 1} of {photos.length}
                </p>
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                  {photos[selectedPhotoIndex].filename}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
