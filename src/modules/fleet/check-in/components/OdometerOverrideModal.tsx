/**
 * OdometerOverrideModal Component
 * Modal for manual odometer entry with verification photo when VLM reading is rejected
 * Requires both manual entry AND a verification photo before allowing confirmation
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  X,
  Camera,
  AlertTriangle,
  Gauge,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

interface OdometerOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (manualReading: number, verificationPhotoDataUrl: string) => void;
  rejectionReason: string;
  vlmExtractedValue: number | null;
  previousReading: number | null;
  vehicleRegistration: string;
}

export function OdometerOverrideModal({
  isOpen,
  onClose,
  onConfirm,
  rejectionReason,
  vlmExtractedValue,
  previousReading,
  vehicleRegistration,
}: OdometerOverrideModalProps) {
  const [manualReading, setManualReading] = useState<string>('');
  const [verificationPhoto, setVerificationPhoto] = useState<string | null>(null);

  // File input ref (uses native camera — no getUserMedia permission needed)
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Validation
  const manualValue = parseInt(manualReading, 10);
  const isValidReading = !isNaN(manualValue) && manualValue > 0;
  const hasVerificationPhoto = !!verificationPhoto;
  const canConfirm = isValidReading && hasVerificationPhoto;

  // Check if manual reading makes sense
  const readingWarning = isValidReading && previousReading
    ? manualValue < previousReading
      ? `Warning: Reading is less than previous (${previousReading.toLocaleString()} km)`
      : manualValue - previousReading > 1000
        ? `Large jump: ${(manualValue - previousReading).toLocaleString()} km since last reading`
        : null
    : null;

  // Compress photo to max 1280px wide, JPEG 0.85 quality
  const compressPhoto = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxWidth = 1280;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        resolve(canvas.toDataURL('image/jpeg', 0.85));
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // Handle photo from native camera file input
  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const dataUrl = await compressPhoto(file);
    setVerificationPhoto(dataUrl);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [compressPhoto]);

  // Open native camera
  const openCamera = useCallback(() => {
    cameraInputRef.current?.click();
  }, []);

  // Retake photo
  const retakePhoto = useCallback(() => {
    setVerificationPhoto(null);
    cameraInputRef.current?.click();
  }, []);

  // Handle confirm
  const handleConfirm = () => {
    if (canConfirm && verificationPhoto) {
      onConfirm(manualValue, verificationPhoto);
    }
  };

  // Close and cleanup
  const handleClose = () => {
    setManualReading('');
    setVerificationPhoto(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">
                Reading Rejected
              </h2>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {rejectionReason}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Info about rejected value */}
          <div className="p-3 bg-input rounded-lg">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">Vehicle:</span> {vehicleRegistration}
            </p>
            {vlmExtractedValue && (
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium">VLM Read:</span>{' '}
                <span className="line-through text-red-500">{vlmExtractedValue.toLocaleString()} km</span>
              </p>
            )}
            {previousReading && (
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium">Previous:</span> {previousReading.toLocaleString()} km
              </p>
            )}
          </div>

          {/* Step 1: Manual Entry */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                isValidReading ? 'bg-green-500 text-white' : 'bg-secondary text-muted-foreground'
              }`}>
                {isValidReading ? <CheckCircle2 className="w-4 h-4" /> : '1'}
              </div>
              <label className="font-medium text-foreground">
                Enter Correct Mileage
              </label>
            </div>
            <div className="ml-8">
              <div className="relative">
                <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="number"
                  value={manualReading}
                  onChange={(e) => setManualReading(e.target.value)}
                  placeholder="Enter odometer reading"
                  className="w-full pl-10 pr-12 py-3 border rounded-lg text-lg bg-card dark:border-gray-700 focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">km</span>
              </div>
              {readingWarning && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {readingWarning}
                </p>
              )}
            </div>
          </div>

          {/* Step 2: Verification Photo */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                hasVerificationPhoto ? 'bg-green-500 text-white' : 'bg-secondary text-muted-foreground'
              }`}>
                {hasVerificationPhoto ? <CheckCircle2 className="w-4 h-4" /> : '2'}
              </div>
              <label className="font-medium text-foreground">
                Take Verification Photo
              </label>
            </div>
            <div className="ml-8">
              {/* Hidden file input — triggers native camera */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                className="hidden"
              />

              {verificationPhoto ? (
                <div className="relative">
                  <img
                    src={verificationPhoto}
                    alt="Verification"
                    className="w-full h-48 object-cover rounded-lg border dark:border-gray-700"
                  />
                  <button
                    onClick={retakePhoto}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg flex items-center gap-1 hover:bg-black/80"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retake
                  </button>
                </div>
              ) : (
                <button
                  onClick={openCamera}
                  className="w-full h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-blue-400 hover:text-blue-500 transition-colors"
                >
                  <Camera className="w-8 h-8" />
                  <span className="text-sm">Tap to take photo of odometer</span>
                </button>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Photo will be saved for audit purposes
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t dark:border-gray-800 p-4 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-3 px-4 border rounded-lg font-medium text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
              canConfirm
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'bg-secondary text-muted-foreground cursor-not-allowed dark:bg-gray-800 dark:text-muted-foreground'
            }`}
          >
            <CheckCircle2 className="w-5 h-5" />
            Confirm Reading
          </button>
        </div>
      </div>
    </div>
  );
}
