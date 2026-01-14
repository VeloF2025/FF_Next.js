/**
 * CheckInPhotoGrid Component
 * Grid of photo capture buttons for vehicle check-in
 */

import React, { useRef } from 'react';
import { Camera, X, Check } from 'lucide-react';
import type { CheckPhotoType } from '../../types/check-in.types';
import { REQUIRED_PHOTOS } from '../../types/check-in.types';

interface PhotoData {
  dataUrl: string;
  file?: File;
}

interface CheckInPhotoGridProps {
  photos: Map<CheckPhotoType, PhotoData>;
  onPhotoCapture: (type: CheckPhotoType, dataUrl: string, file?: File) => void;
  onPhotoRemove: (type: CheckPhotoType) => void;
  hasDamage?: boolean; // Show damage photo option
}

export function CheckInPhotoGrid({
  photos,
  onPhotoCapture,
  onPhotoRemove,
  hasDamage = false,
}: CheckInPhotoGridProps) {
  const inputRefs = useRef<Map<CheckPhotoType, HTMLInputElement>>(new Map());

  const visiblePhotos = REQUIRED_PHOTOS.filter(
    p => p.type !== 'damage' || hasDamage || photos.has('damage')
  );

  const handleCapture = async (type: CheckPhotoType) => {
    const input = inputRefs.current.get(type);
    if (input) {
      input.click();
    }
  };

  const handleFileChange = async (
    type: CheckPhotoType,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Convert to data URL
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onPhotoCapture(type, dataUrl, file);
    };
    reader.readAsDataURL(file);

    // Reset input for re-capture
    event.target.value = '';
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900 dark:text-white">Vehicle Photos</h3>

      <div className="grid grid-cols-2 gap-4">
        {visiblePhotos.map(({ type, label, required }) => {
          const photo = photos.get(type);
          const hasPhoto = !!photo;

          return (
            <div key={type} className="relative">
              {/* Hidden file input */}
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(type, el);
                }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFileChange(type, e)}
              />

              {hasPhoto ? (
                /* Photo preview */
                <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <img
                    src={photo.dataUrl}
                    alt={label}
                    className="w-full h-full object-cover"
                  />
                  {/* Overlay with label and remove button */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent">
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                      <span className="text-white text-sm font-medium">{label}</span>
                      <button
                        type="button"
                        onClick={() => onPhotoRemove(type)}
                        className="p-1 rounded-full bg-red-500 text-white hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Success indicator */}
                  <div className="absolute top-2 right-2 p-1 rounded-full bg-green-500 text-white">
                    <Check className="w-4 h-4" />
                  </div>
                </div>
              ) : (
                /* Capture button */
                <button
                  type="button"
                  onClick={() => handleCapture(type)}
                  className={`w-full aspect-video rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors ${
                    required
                      ? 'border-gray-300 dark:border-gray-600 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-400'
                  }`}
                >
                  <Camera className={`w-8 h-8 ${required ? 'text-gray-400' : 'text-gray-300'}`} />
                  <span className={`text-sm font-medium ${required ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400'}`}>
                    {label}
                  </span>
                  {required && (
                    <span className="text-xs text-red-500">Required</span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add damage photo button if not visible */}
      {!hasDamage && !photos.has('damage') && (
        <button
          type="button"
          onClick={() => handleCapture('damage')}
          className="w-full py-3 px-4 rounded-lg border border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20 flex items-center justify-center gap-2"
        >
          <Camera className="w-5 h-5" />
          <span>Add damage photo (if applicable)</span>
        </button>
      )}
    </div>
  );
}
