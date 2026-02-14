/**
 * PhotoGalleryUnified Component
 *
 * Display photos from unified review with step grouping
 *
 * Features:
 * - Group photos by step number
 * - Photo lightbox for viewing
 * - Photo source badge (OneMap/BOSS/Local)
 * - Responsive grid layout
 * - Photo metadata display (filename, size, modified)
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { Photo, PhotoSource } from '../types/unified.types';
import { STEP_LABELS } from '../types/unified.types';

interface PhotoGalleryUnifiedProps {
  photos: Photo[];
  source: PhotoSource | null;
  groupByStep?: boolean;
  onPhotoClick?: (photo: Photo) => void;
}

export function PhotoGalleryUnified({
  photos,
  source,
  groupByStep = true,
  onPhotoClick,
}: PhotoGalleryUnifiedProps) {
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);

  if (photos.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <span className="text-3xl">📸</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Photos Available</h3>
        <p className="text-gray-600 dark:text-gray-400">
          Photos will appear here once they are fetched from the source
        </p>
      </div>
    );
  }

  const handlePhotoClick = (photo: Photo) => {
    setLightboxPhoto(photo);
    onPhotoClick?.(photo);
  };

  const closeLightbox = () => {
    setLightboxPhoto(null);
  };

  if (groupByStep) {
    return (
      <>
        <StepGroupedGallery
          photos={photos}
          source={source}
          onPhotoClick={handlePhotoClick}
        />
        {lightboxPhoto && (
          <PhotoLightbox photo={lightboxPhoto} onClose={closeLightbox} />
        )}
      </>
    );
  }

  return (
    <>
      <SimpleGallery
        photos={photos}
        source={source}
        onPhotoClick={handlePhotoClick}
      />
      {lightboxPhoto && (
        <PhotoLightbox photo={lightboxPhoto} onClose={closeLightbox} />
      )}
    </>
  );
}

/**
 * Step-Grouped Gallery
 * Groups photos by step number with collapsible sections
 */
interface StepGroupedGalleryProps {
  photos: Photo[];
  source: PhotoSource | null;
  onPhotoClick: (photo: Photo) => void;
}

function StepGroupedGallery({ photos, source, onPhotoClick }: StepGroupedGalleryProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3])); // Default: expand first 3 steps

  // Group photos by step
  const photosByStep: Record<number, Photo[]> = {};
  photos.forEach((photo) => {
    if (!photosByStep[photo.step]) {
      photosByStep[photo.step] = [];
    }
    photosByStep[photo.step].push(photo);
  });

  const toggleStep = (step: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(step)) {
      newExpanded.delete(step);
    } else {
      newExpanded.add(step);
    }
    setExpandedSteps(newExpanded);
  };

  return (
    <div className="space-y-4">
      {/* Photo Source Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Source:</span>
          <PhotoSourceBadge source={source} />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => {
            const allSteps = new Set(Object.keys(photosByStep).map(Number));
            setExpandedSteps(expandedSteps.size === allSteps.size ? new Set() : allSteps);
          }}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          {expandedSteps.size === Object.keys(photosByStep).length ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Step Sections */}
      <div className="space-y-3">
        {Object.entries(photosByStep)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([stepStr, stepPhotos]) => {
            const step = parseInt(stepStr);
            const isExpanded = expandedSteps.has(step);

            return (
              <div
                key={step}
                className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden"
              >
                {/* Step Header */}
                <button
                  onClick={() => toggleStep(step)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-semibold text-sm">
                      {step}
                    </span>
                    <div className="text-left">
                      <h4 className="font-medium text-gray-900 dark:text-white">
                        {STEP_LABELS[step] || `Step ${step}`}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {stepPhotos.length} photo{stepPhotos.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 dark:text-gray-500 dark:text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* Step Photos */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {stepPhotos.map((photo, index) => (
                        <PhotoThumbnail
                          key={`${photo.filename}-${index}`}
                          photo={photo}
                          onClick={() => onPhotoClick(photo)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * Simple Gallery
 * Display all photos in a grid without grouping
 */
interface SimpleGalleryProps {
  photos: Photo[];
  source: PhotoSource | null;
  onPhotoClick: (photo: Photo) => void;
}

function SimpleGallery({ photos, source, onPhotoClick }: SimpleGalleryProps) {
  return (
    <div className="space-y-4">
      {/* Photo Source Header */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">Source:</span>
        <PhotoSourceBadge source={source} />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {photos.length} photo{photos.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Photo Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map((photo, index) => (
          <PhotoThumbnail
            key={`${photo.filename}-${index}`}
            photo={photo}
            onClick={() => onPhotoClick(photo)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Photo Thumbnail
 * Individual photo thumbnail with metadata
 */
interface PhotoThumbnailProps {
  photo: Photo;
  onClick: () => void;
}

function PhotoThumbnail({ photo, onClick }: PhotoThumbnailProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      onClick={onClick}
      className="group relative aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400 transition-all"
    >
      {!imageError ? (
        <Image
          src={photo.url}
          alt={photo.filename}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-200"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 dark:text-gray-400">
          <svg
            className="w-12 h-12 mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-xs">Failed to load</span>
        </div>
      )}

      {/* Overlay with filename */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-white text-xs truncate">{photo.filename}</p>
        {photo.size && (
          <p className="text-white/80 text-xs">
            {formatFileSize(photo.size)}
          </p>
        )}
      </div>

      {/* Step Badge */}
      <div className="absolute top-2 left-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-xs font-bold">
          {photo.step}
        </span>
      </div>
    </div>
  );
}

/**
 * Photo Lightbox
 * Full-screen photo viewer with navigation and metadata
 */
interface PhotoLightboxProps {
  photo: Photo;
  onClose: () => void;
}

function PhotoLightbox({ photo, onClose }: PhotoLightboxProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-6xl w-full max-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Image */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden">
          {!imageError ? (
            <img
              src={photo.url}
              alt={photo.filename}
              className="w-full h-auto max-h-[80vh] object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex items-center justify-center min-h-[400px] text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <svg
                  className="w-24 h-24 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-white">Failed to load image</p>
              </div>
            </div>
          )}

          {/* Metadata Overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-6">
            <div className="text-white space-y-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
                  {photo.step}
                </span>
                <h3 className="font-semibold">
                  {STEP_LABELS[photo.step] || `Step ${photo.step}`}
                </h3>
              </div>
              <p className="text-sm text-gray-300">{photo.filename}</p>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                {photo.size && <span>Size: {formatFileSize(photo.size)}</span>}
                {photo.modified && (
                  <span>Modified: {new Date(photo.modified).toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Photo Source Badge
 * Display photo source with appropriate styling
 */
interface PhotoSourceBadgeProps {
  source: PhotoSource | null;
}

function PhotoSourceBadge({ source }: PhotoSourceBadgeProps) {
  const sourceConfig: Record<PhotoSource, { label: string; color: string }> = {
    onemap: { label: 'OneMap GIS', color: 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200' },
    boss: { label: 'BOSS API', color: 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200' },
    local: { label: 'Local Cache', color: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200' },
  };

  const fallback = { label: source || 'Unknown', color: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200' };
  const config = (source && sourceConfig[source]) || fallback;

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

/**
 * Helper: Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
