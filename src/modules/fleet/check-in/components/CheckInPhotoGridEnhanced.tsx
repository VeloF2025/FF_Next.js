/**
 * CheckInPhotoGridEnhanced Component
 * Enhanced photo grid with dynamic required photos and VLM status
 */

import React, { useRef } from 'react';
import { Camera, X, Check, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { CheckPhotoType, VlmAnalysisType } from '../../types/check-in.types';

interface PhotoData {
  dataUrl: string;
  file?: File;
}

interface VlmResult {
  photoType: CheckPhotoType;
  analysisType: VlmAnalysisType;
  extractedValue: string | null;
  extractedNumeric: number | null;
  confidence: number;
  plateMatches?: boolean;
  isProcessing: boolean;
  error?: string;
}

interface PhotoConfig {
  type: CheckPhotoType;
  label: string;
  required: boolean;
  vlmType?: VlmAnalysisType;
}

interface CheckInPhotoGridEnhancedProps {
  photos: Map<CheckPhotoType, PhotoData>;
  requiredPhotos: PhotoConfig[];
  vlmResults: Map<CheckPhotoType, VlmResult>;
  onPhotoCapture: (type: CheckPhotoType, dataUrl: string, file?: File, latitude?: number | null, longitude?: number | null) => void;
  onPhotoRemove: (type: CheckPhotoType) => void;
  hasDamage?: boolean;
}

export function CheckInPhotoGridEnhanced({
  photos,
  requiredPhotos,
  vlmResults,
  onPhotoCapture,
  onPhotoRemove,
  hasDamage = false,
}: CheckInPhotoGridEnhancedProps) {
  const inputRefs = useRef<Map<CheckPhotoType, HTMLInputElement>>(new Map());

  // Filter visible photos - always show required ones, show damage if needed
  const visiblePhotos = requiredPhotos.filter(
    p => p.type !== 'damage' || hasDamage || photos.has('damage')
  );

  const handleCapture = async (type: CheckPhotoType) => {
    const input = inputRefs.current.get(type);
    if (input) {
      input.click();
    }
  };

  const handleFileChange = (
    type: CheckPhotoType,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Convert to data URL FIRST - don't block on GPS
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;

      // Capture GPS coordinates in background (non-blocking)
      // Photo appears immediately, GPS coords added if available
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            // Got GPS - call with coordinates
            onPhotoCapture(type, dataUrl, file, position.coords.latitude, position.coords.longitude);
          },
          () => {
            // GPS failed or denied - still capture photo without coords
            onPhotoCapture(type, dataUrl, file, null, null);
          },
          {
            enableHighAccuracy: false, // Faster on mobile
            timeout: 3000, // Shorter timeout
            maximumAge: 60000, // Accept cached position up to 1 min old
          }
        );
      } else {
        // No geolocation support - capture without coords
        onPhotoCapture(type, dataUrl, file, null, null);
      }
    };
    reader.onerror = () => {
      console.error('Failed to read photo file');
    };
    reader.readAsDataURL(file);

    // Reset input for re-capture
    event.target.value = '';
  };

  // Get VLM status badge for a photo
  const getVlmBadge = (type: CheckPhotoType) => {
    const vlmResult = vlmResults.get(type);
    if (!vlmResult) return null;

    if (vlmResult.isProcessing) {
      return (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-blue-500 text-white text-xs rounded-full">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Processing</span>
        </div>
      );
    }

    if (vlmResult.error) {
      return (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-red-500 text-white text-xs rounded-full">
          <AlertCircle className="w-3 h-3" />
          <span>Error</span>
        </div>
      );
    }

    if (vlmResult.extractedNumeric !== null || vlmResult.extractedValue) {
      const confidence = Math.round(vlmResult.confidence * 100);
      const bgColor = confidence >= 80 ? 'bg-green-500' : confidence >= 50 ? 'bg-yellow-500' : 'bg-orange-500';

      return (
        <div className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-1 ${bgColor} text-white text-xs rounded-full`}>
          <CheckCircle2 className="w-3 h-3" />
          <span>{confidence}%</span>
        </div>
      );
    }

    return null;
  };

  // Get extracted value preview
  const getVlmPreview = (type: CheckPhotoType) => {
    const vlmResult = vlmResults.get(type);
    if (!vlmResult || vlmResult.isProcessing || vlmResult.error) return null;

    if (vlmResult.extractedNumeric !== null) {
      if (vlmResult.analysisType === 'odometer') {
        return (
          <span className="text-xs text-white bg-black/50 px-2 py-0.5 rounded">
            {vlmResult.extractedNumeric.toLocaleString()} km
          </span>
        );
      }
      if (vlmResult.analysisType === 'fuel_gauge') {
        return (
          <span className="text-xs text-white bg-black/50 px-2 py-0.5 rounded">
            {vlmResult.extractedNumeric}%
          </span>
        );
      }
    }

    if (vlmResult.analysisType === 'license_plate' && vlmResult.extractedValue) {
      return (
        <span className={`text-xs px-2 py-0.5 rounded ${
          vlmResult.plateMatches
            ? 'bg-green-500 text-white'
            : 'bg-red-500 text-white'
        }`}>
          {vlmResult.extractedValue} {vlmResult.plateMatches ? '✓' : '✗'}
        </span>
      );
    }

    return null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {visiblePhotos.map(({ type, label, required, vlmType }) => {
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

                  {/* VLM processing/result badge */}
                  {vlmType && getVlmBadge(type)}

                  {/* Overlay with label and controls */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent">
                    <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-white text-sm font-medium">{label}</span>
                        <button
                          type="button"
                          onClick={() => onPhotoRemove(type)}
                          className="p-1 rounded-full bg-red-500 text-white hover:bg-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {/* VLM extracted value preview */}
                      {vlmType && getVlmPreview(type)}
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
                  <span className={`text-sm font-medium text-center px-2 ${required ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400'}`}>
                    {label}
                  </span>
                  {required && (
                    <span className="text-xs text-red-500">Required</span>
                  )}
                  {vlmType && (
                    <span className="text-xs text-blue-500">Auto-read</span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add damage photo button if not in required list */}
      {!requiredPhotos.some(p => p.type === 'damage') && !photos.has('damage') && (
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
