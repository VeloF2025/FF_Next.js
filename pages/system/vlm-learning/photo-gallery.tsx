/**
 * System > VLM Learning > Photo Gallery
 * URL: /system/vlm-learning/photo-gallery
 *
 * Relocated from /activate/photo-gallery.
 * Renders the same PhotoGalleryPage component.
 */

import { AppLayout } from '@/components/layout';
import PhotoGalleryPage from '@/modules/activate/components/PhotoGalleryPage';

export default function VlmPhotoGalleryRoute() {
  return (
    <AppLayout>
      <PhotoGalleryPage />
    </AppLayout>
  );
}
