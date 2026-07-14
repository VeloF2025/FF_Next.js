'use client';

/**
 * SiteCamPhotosSection
 *
 * Renders the photos captured through the SiteCam /my PWA wizard for a DR,
 * grouped by step, as the body of a bucket inside the Activate DR Review
 * "Photos" tab — visually parallel to the Installation / Group / Maintenance
 * buckets. Data comes from the useSiteCamPhotos hook (pwa_photo_urls).
 *
 * The step-10 image is the customer sign-off composite; it renders like any
 * other photo, no special handling.
 */

import { PhotoGalleryUnified } from './PhotoGalleryUnified';
import type { SiteCamData } from '../hooks/useSiteCamPhotos';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

/** Body content for the SiteCam bucket: header + step-grouped gallery, or an empty state. */
export function SiteCamPhotosSection({ data }: { data: SiteCamData }) {
  const { photos, submittedAt, techName, loading, error } = data;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" label="" />
      </div>
    );
  }

  if (error) {
    return <div className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (photos.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No SiteCam photos yet. Photos captured via the SiteCam app will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(submittedAt || techName) && (
        <div className="text-xs text-muted-foreground">
          {submittedAt && `Submitted ${new Date(submittedAt).toLocaleString()}`}
          {submittedAt && techName && ' · '}
          {techName && `Tech: ${techName}`}
        </div>
      )}
      <PhotoGalleryUnified photos={photos} source="sitecam" groupByStep />
    </div>
  );
}
