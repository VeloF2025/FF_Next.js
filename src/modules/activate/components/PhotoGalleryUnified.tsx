/**
 * PhotoGalleryUnified Component
 *
 * Display photos from unified review with step grouping
 *
 * Features:
 * - Group photos by step number
 * - Full-screen photo lightbox with zoom/pan/navigation
 * - Photo source badge (OneMap/BOSS/Local)
 * - Responsive grid layout
 * - Photo metadata display (filename, size, modified)
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { Photo, PhotoSource } from '../types/unified.types';
import { STEP_LABELS } from '../types/unified.types';
import { PhotoLightbox as SharedLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build flat lightbox photo list for navigation
  const lightboxPhotos: LightboxPhoto[] = useMemo(() =>
    photos.map(p => ({
      url: p.url,
      label: p.filename,
      metadata: p.step
        ? `Step ${p.step}: ${STEP_LABELS[p.step] || 'Unknown'}${p.size ? ` — ${formatFileSize(p.size)}` : ''}`
        : undefined,
    })),
    [photos]
  );

  if (photos.length === 0) {
    return (
      <div className="text-center py-12 bg-background/50 rounded-lg border border-border">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-secondary mb-4">
          <span className="text-3xl">📸</span>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No Photos Available</h3>
        <p className="text-muted-foreground">
          Photos will appear here once they are fetched from the source
        </p>
      </div>
    );
  }

  const handlePhotoClick = (photo: Photo) => {
    const idx = photos.indexOf(photo);
    setLightboxIndex(idx >= 0 ? idx : 0);
    onPhotoClick?.(photo);
  };

  const lightbox = lightboxIndex !== null ? (
    <SharedLightbox
      photos={lightboxPhotos}
      initialIndex={lightboxIndex}
      onClose={() => setLightboxIndex(null)}
    />
  ) : null;

  if (groupByStep) {
    return (
      <>
        <StepGroupedGallery
          photos={photos}
          source={source}
          onPhotoClick={handlePhotoClick}
        />
        {lightbox}
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
      {lightbox}
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
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3]));

  // Group photos by step
  const photosByStep: Record<number, Photo[]> = {};
  photos.forEach((photo) => {
    const step = photo.step ?? 0;
    if (!photosByStep[step]) {
      photosByStep[step] = [];
    }
    photosByStep[step].push(photo);
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
          <span className="text-sm text-muted-foreground">Source:</span>
          <PhotoSourceBadge source={source} />
          <span className="text-sm text-muted-foreground">
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            const allSteps = new Set(Object.keys(photosByStep).map(Number));
            setExpandedSteps(expandedSteps.size === allSteps.size ? new Set() : allSteps);
          }}
        >
          {expandedSteps.size === Object.keys(photosByStep).length ? 'Collapse All' : 'Expand All'}
        </Button>
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
                className="border border-border rounded-lg bg-card overflow-hidden"
              >
                {/* Step Header */}
                <button
                  onClick={() => toggleStep(step)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-semibold text-sm">
                      {step}
                    </span>
                    <div className="text-left">
                      <h4 className="font-medium text-foreground">
                        {STEP_LABELS[step] || `Step ${step}`}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {stepPhotos.length} photo{stepPhotos.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 dark:text-muted-foreground transition-transform ${
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
                  <div className="border-t border-border p-4">
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
        <span className="text-sm text-muted-foreground">Source:</span>
        <PhotoSourceBadge source={source} />
        <span className="text-sm text-muted-foreground">
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
      className="group relative aspect-square bg-secondary rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400 transition-all"
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
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-muted-foreground">
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
    local: { label: 'Local Cache', color: 'bg-secondary text-foreground' },
  };

  const fallback = { label: source || 'Unknown', color: 'bg-secondary text-foreground' };
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
