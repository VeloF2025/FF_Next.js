/**
 * Photo Gallery — Criteria Review (Pages Router)
 * Accessible at /activate/photo-gallery
 *
 * Shows accepted photos from PASS DRs grouped by step.
 * Used to review and select good/bad photo examples for PhotoGuide PWA criteria.
 *
 * Pages Router (not src/app) on purpose: the literal /activate/photo-gallery
 * segment takes precedence over the pages/activate/[dropNumber] dynamic route,
 * which would otherwise shadow an App Router page at the same path.
 */

import { AppLayout } from '@/components/layout';
import PhotoGalleryPage from '@/modules/activate/components/PhotoGalleryPage';

export default function PhotoGalleryRoute() {
  return (
    <AppLayout>
      <PhotoGalleryPage />
    </AppLayout>
  );
}
