/**
 * WAPhotosGallery Component
 *
 * Display WhatsApp photos for a DR with lightbox support
 *
 * Features:
 * - Grid display of WA photos
 * - Photo lightbox for viewing
 * - VLM-extracted serial info display
 * - Sender and timestamp metadata
 *
 * @module activate/components/WAPhotosGallery
 */

'use client';

import { useState } from 'react';
// Using regular img for proxied images (Next.js Image optimizer can't handle auth-protected API routes)
import { format } from 'date-fns';
import { User, Camera, Cpu, ZoomIn } from 'lucide-react';

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
  const [lightboxPhoto, setLightboxPhoto] = useState<WAPhoto | null>(null);

  if (photos.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
        <Camera className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-600 dark:text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map((photo) => (
          <WAPhotoThumbnail
            key={photo.id}
            photo={photo}
            showVlmInfo={showVlmInfo}
            onClick={() => setLightboxPhoto(photo)}
          />
        ))}
      </div>

      {lightboxPhoto && (
        <WAPhotoLightbox
          photo={lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
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
  // Build image URL from proxy_url or construct from local_path
  // NEW local_path format: /var/lib/docker/volumes/boss-vps_dr_photos/_data/{DR}/{filename}
  const getImageUrl = () => {
    if (photo.proxy_url) return photo.proxy_url;
    if (!photo.local_path) return '';
    const pathParts = photo.local_path.split('/');
    const filename = pathParts[pathParts.length - 1];
    const drFolder = pathParts[pathParts.length - 2];
    return `/api/activate/photo/${drFolder}/${filename}`;
  };
  const imageUrl = getImageUrl();

  return (
    <div
      onClick={onClick}
      className="group relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400 transition-all"
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
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
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
      <div className="p-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <User className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{photo.sender_name || 'Unknown'}</span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
          {format(new Date(photo.message_timestamp), 'dd MMM HH:mm')}
        </div>

        {/* VLM Extracted Serials */}
        {showVlmInfo && (photo.vlm_ont_serial || photo.vlm_ups_serial) && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
            {photo.vlm_ont_serial && (
              <div className="text-xs">
                <span className="text-gray-500 dark:text-gray-500">ONT:</span>{' '}
                <span className="font-mono text-green-600 dark:text-green-400">
                  {photo.vlm_ont_serial}
                </span>
              </div>
            )}
            {photo.vlm_ups_serial && (
              <div className="text-xs">
                <span className="text-gray-500 dark:text-gray-500">UPS:</span>{' '}
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

interface WAPhotoLightboxProps {
  photo: WAPhoto;
  onClose: () => void;
}

function WAPhotoLightbox({ photo, onClose }: WAPhotoLightboxProps) {
  const [imageError, setImageError] = useState(false);
  // Build image URL from proxy_url or construct from local_path
  const getImageUrl = () => {
    if (photo.proxy_url) return photo.proxy_url;
    if (!photo.local_path) return '';
    const pathParts = photo.local_path.split('/');
    const filename = pathParts[pathParts.length - 1];
    const drFolder = pathParts[pathParts.length - 2];
    return `/api/activate/photo/${drFolder}/${filename}`;
  };
  const imageUrl = getImageUrl();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full max-h-full"
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
              src={imageUrl}
              alt={photo.original_filename || 'WA Photo'}
              className="w-full h-auto max-h-[75vh] object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex items-center justify-center min-h-[400px] text-gray-500">
              <div className="text-center">
                <Camera className="h-24 w-24 mx-auto mb-4 text-gray-600" />
                <p className="text-white">Failed to load image</p>
              </div>
            </div>
          )}

          {/* Metadata Overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-6">
            <div className="text-white space-y-3">
              {/* Sender Info */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-700">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{photo.sender_name || 'Unknown'}</p>
                  <p className="text-sm text-gray-400">
                    {format(new Date(photo.message_timestamp), 'dd MMM yyyy HH:mm:ss')}
                  </p>
                </div>
              </div>

              {/* VLM Extracted Serials */}
              {(photo.vlm_ont_serial || photo.vlm_ups_serial) && (
                <div className="flex items-center gap-6 pt-3 border-t border-gray-700">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-purple-400" />
                    <span className="text-sm text-gray-400">AI Extracted:</span>
                  </div>
                  {photo.vlm_ont_serial && (
                    <div className="text-sm">
                      <span className="text-gray-400">ONT:</span>{' '}
                      <span className="font-mono text-green-400">{photo.vlm_ont_serial}</span>
                    </div>
                  )}
                  {photo.vlm_ups_serial && (
                    <div className="text-sm">
                      <span className="text-gray-400">UPS:</span>{' '}
                      <span className="font-mono text-blue-400">{photo.vlm_ups_serial}</span>
                    </div>
                  )}
                </div>
              )}

              {/* File Info */}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                {photo.original_filename && <span>{photo.original_filename}</span>}
                {photo.file_size_bytes && (
                  <span>{formatFileSize(photo.file_size_bytes)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
