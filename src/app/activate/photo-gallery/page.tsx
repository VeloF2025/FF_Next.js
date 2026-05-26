/**
 * Photo Gallery — Criteria Review
 * Accessible at /activate/photo-gallery
 *
 * Shows accepted photos from PASS DRs grouped by step.
 * Used to review and select good/bad photo examples for PhotoGuide PWA criteria.
 */

'use client';

import { AppLayout } from '@/components/layout';
import PhotoGalleryPage from '@/modules/activate/components/PhotoGalleryPage';

export default function PhotoGalleryRoute() {
  return (
    <AppLayout>
      <PhotoGalleryPage />
    </AppLayout>
  );
}
