/**
 * WAPhotosGallery Component
 *
 * Display WhatsApp photos for a DR with lightbox support
 *
 * Features:
 * - Grid display of WA photos
 * - Full-screen photo lightbox with zoom/pan/navigation
 * - VLM-extracted serial info display
 * - Sender and timestamp metadata
 *
 * @module activate/components/WAPhotosGallery
 */

'use client';

import { useState, useMemo } from 'react';
// Using regular img for proxied images (Next.js Image optimizer can't handle auth-protected API routes)
import { format } from 'date-fns';
import { User, Camera, Cpu, ZoomIn } from 'lucide-react';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';

export interface WAPhoto {
  id: string;
  wa_message_id: string;
  wa_group_jid: string;
  sender_name: string | null;
  message_timestamp: string;
  original_filename: string | null;
  local_path: string | null;
  mime_type: string;
  file_size_bytes: number | null;
  vlm_ont_serial: string | null;
  vlm_ups_serial: string | null;
  vlm_processed: boolean;
  created_at: string;
  proxy_url?: string;
}

/** Build image URL from proxy_url or local_path */
function getWAPhotoUrl(photo: WAPhoto): string {
  if (photo.proxy_url) return photo.proxy_url;
  if (!photo.local_path) return '';
  const pathParts = photo.local_path.split('/');
  const filename = pathParts[pathParts.length - 1];
  const drFolder = pathParts[pathParts.length - 2];
  return `/api/activate/photo/${drFolder}/${filename}`;
}

interface WAPhotosGalleryProps {
  photos: WAPhoto[];
  emptyMessage?: string;
  showVlmInfo?: boolean;
}

export function WAPhotosGallery({
  photos,
  emptyMessage = 'No photos available',
  showVlmInfo = true,
}: WAPhotosGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build flat lightbox photo list for navigation
  const lightboxPhotos: LightboxPhoto[] = useMemo(() =>
    photos.map(p => {
      const url = getWAPhotoUrl(p);
      const parts: string[] = [];
      if (p.sender_name) parts.push(`From: ${p.sender_name}`);
      parts.push(format(new Date(p.message_timestamp), 'dd MMM yyyy HH:mm'));
      if (p.vlm_ont_serial) parts.push(`ONT: ${p.vlm_ont_serial}`);
      if (p.vlm_ups_serial) parts.push(`UPS: ${p.vlm_ups_serial}`);
      return {
        url,
        label: p.original_filename || 'WA Photo',
        metadata: parts.join('  |  '),
      };
    }),
    [photos]
  );

  if (photos.length === 0) {
    return (
      <div className="text-center py-8 bg-background/50 rounded-lg border border-border">
        <Camera className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map((photo, idx) => (
          <WAPhotoThumbnail
            key={photo.id}
            photo={photo}
            showVlmInfo={showVlmInfo}
            onClick={() => setLightboxIndex(idx)}
          />
        ))}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

interface WAPhotoThumbnailProps {
  photo: WAPhoto;
  showVlmInfo: boolean;
  onClick: () => void;
}

function WAPhotoThumbnail({ photo, showVlmInfo, onClick }: WAPhotoThumbnailProps) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = getWAPhotoUrl(photo);

  return (
    <div
      onClick={onClick}
      className="group relative bg-secondary rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400 transition-all"
    >
      {/* Image */}
      <div className="aspect-square relative">
        {!imageError ? (
          <img
            src={imageUrl}
            alt={photo.original_filename || 'WA Photo'}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-muted-foreground">
            <Camera className="h-10 w-10 mb-2" />
            <span className="text-xs">Failed to load</span>
          </div>
        )}

        {/* Zoom indicator */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <ZoomIn className="h-8 w-8 text-white" />
        </div>

        {/* VLM Processed Badge */}
        {showVlmInfo && photo.vlm_processed && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-600 text-white">
              <Cpu className="h-3 w-3" />
              AI
            </span>
          </div>
        )}
      </div>

      {/* Metadata Footer */}
      <div className="p-2 bg-card border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{photo.sender_name || 'Unknown'}</span>
        </div>
        <div className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
          {format(new Date(photo.message_timestamp), 'dd MMM HH:mm')}
        </div>

        {/* VLM Extracted Serials */}
        {showVlmInfo && (photo.vlm_ont_serial || photo.vlm_ups_serial) && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
            {photo.vlm_ont_serial && (
              <div className="text-xs">
                <span className="text-muted-foreground dark:text-gray-400">ONT:</span>{' '}
                <span className="font-mono text-green-600 dark:text-green-400">
                  {photo.vlm_ont_serial}
                </span>
              </div>
            )}
            {photo.vlm_ups_serial && (
              <div className="text-xs">
                <span className="text-muted-foreground dark:text-gray-400">UPS:</span>{' '}
                <span className="font-mono text-blue-600 dark:text-blue-400">
                  {photo.vlm_ups_serial}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
