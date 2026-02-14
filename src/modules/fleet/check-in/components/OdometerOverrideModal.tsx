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
  ImageIcon,
  RefreshCw,
} from 'lucide-react';
import { log } from '@/lib/logger';

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
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setIsCapturing(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Back camera
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      log.error('Failed to access camera', { error: err }, 'OdometerOverrideModal');
      const error = err as DOMException;
      if (error.name === 'NotAllowedError') {
        setCameraError(
          'Camera permission was denied. To fix this:\n' +
          '1. Tap the lock/settings icon in your browser address bar\n' +
          '2. Find "Camera" and set it to "Allow"\n' +
          '3. Refresh the page and try again'
        );
      } else if (error.name === 'NotReadableError') {
        setCameraError('Camera is being used by another app. Close other apps using the camera and try again.');
      } else {
        setCameraError('Could not access camera. Please check your browser settings and try again.');
      }
      setIsCapturing(false);
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  // Capture photo
  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setVerificationPhoto(dataUrl);
      stopCamera();
    }
  }, [stopCamera]);

  // Retake photo
  const retakePhoto = useCallback(() => {
    setVerificationPhoto(null);
    startCamera();
  }, [startCamera]);

  // Handle confirm
  const handleConfirm = () => {
    if (canConfirm && verificationPhoto) {
      onConfirm(manualValue, verificationPhoto);
    }
  };

  // Close and cleanup
  const handleClose = () => {
    stopCamera();
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
              ) : isCapturing ? (
                <div className="relative">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-48 object-cover rounded-lg bg-black"
                  />
                  <button
                    onClick={capturePhoto}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 w-14 h-14 bg-card rounded-full border-4 border-border shadow-lg flex items-center justify-center hover:bg-secondary"
                  >
                    <div className="w-10 h-10 bg-red-500 rounded-full" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startCamera}
                  className="w-full h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-blue-400 hover:text-blue-500 transition-colors"
                >
                  {cameraError ? (
                    <>
                      <AlertTriangle className="w-8 h-8 text-red-400" />
                      <span className="text-sm text-red-500">{cameraError}</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-8 h-8" />
                      <span className="text-sm">Tap to take photo of odometer</span>
                    </>
                  )}
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
