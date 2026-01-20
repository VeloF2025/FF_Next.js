/**
 * VehicleCalibrationModal Component
 * First-time vehicle setup modal - MANDATORY before first check-in
 *
 * Requirements:
 * 1. Manual odometer reading entry
 * 2. Fuel level selection (radio buttons 0-100% in 10% increments)
 * 3. Dashboard reference photo (for VLM few-shot learning)
 *
 * This modal cannot be dismissed until all steps are complete.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Camera,
  Gauge,
  Fuel,
  CheckCircle2,
  ImageIcon,
  RefreshCw,
  AlertCircle,
  Car,
} from 'lucide-react';

interface VehicleCalibrationModalProps {
  isOpen: boolean;
  onComplete: (calibration: {
    baselineOdometer: number;
    baselineFuelLevel: number;
    dashboardPhotoDataUrl: string;
  }) => void;
  vehicleRegistration: string;
  vehicleMake?: string;
  vehicleModel?: string;
  driverName: string;
}

// Fuel level options (0-100% in 10% increments)
const FUEL_LEVELS = [
  { value: 0, label: 'Empty' },
  { value: 10, label: '10%' },
  { value: 20, label: '20%' },
  { value: 30, label: '30%' },
  { value: 40, label: '40%' },
  { value: 50, label: '50%' },
  { value: 60, label: '60%' },
  { value: 70, label: '70%' },
  { value: 80, label: '80%' },
  { value: 90, label: '90%' },
  { value: 100, label: 'Full' },
];

export function VehicleCalibrationModal({
  isOpen,
  onComplete,
  vehicleRegistration,
  vehicleMake,
  vehicleModel,
  driverName,
}: VehicleCalibrationModalProps) {
  // Form state
  const [odometer, setOdometer] = useState<string>('');
  const [fuelLevel, setFuelLevel] = useState<number | null>(null);
  const [dashboardPhoto, setDashboardPhoto] = useState<string | null>(null);

  // Camera state
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Validation
  const odometerValue = parseInt(odometer, 10);
  const isValidOdometer = !isNaN(odometerValue) && odometerValue >= 0;
  const isValidFuel = fuelLevel !== null;
  const hasPhoto = !!dashboardPhoto;

  const canComplete = isValidOdometer && isValidFuel && hasPhoto;

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
      setCameraError('Could not access camera. Please allow camera permissions.');
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
      setDashboardPhoto(dataUrl);
    }

    stopCamera();
  }, [stopCamera]);

  // Retake photo
  const retakePhoto = useCallback(() => {
    setDashboardPhoto(null);
    startCamera();
  }, [startCamera]);

  // Handle complete
  const handleComplete = () => {
    if (!canComplete || !dashboardPhoto) return;

    onComplete({
      baselineOdometer: odometerValue,
      baselineFuelLevel: fuelLevel!,
      dashboardPhotoDataUrl: dashboardPhoto,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
              <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                First-Time Vehicle Setup
              </h2>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Required before first check-in
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Vehicle Info */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Vehicle</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {vehicleRegistration}
            </p>
            {(vehicleMake || vehicleModel) && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {vehicleMake} {vehicleModel}
              </p>
            )}
          </div>

          {/* Step 1: Odometer */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-full ${
                isValidOdometer
                  ? 'bg-green-100 dark:bg-green-900'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                {isValidOdometer ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-gray-500">1</span>
                )}
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enter Current Mileage
              </label>
            </div>
            <div className="relative">
              <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="e.g., 125430"
                className="w-full pl-10 pr-16 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-lg font-medium
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                km
              </span>
            </div>
          </div>

          {/* Step 2: Fuel Level */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-full ${
                isValidFuel
                  ? 'bg-green-100 dark:bg-green-900'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                {isValidFuel ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-gray-500">2</span>
                )}
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Select Fuel Level
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {FUEL_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setFuelLevel(level.value)}
                  className={`p-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    fuelLevel === level.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
            {fuelLevel !== null && (
              <div className="flex items-center gap-2 mt-2">
                <Fuel className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Selected: <span className="font-medium">{fuelLevel}%</span>
                </span>
              </div>
            )}
          </div>

          {/* Step 3: Dashboard Photo */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-full ${
                hasPhoto
                  ? 'bg-green-100 dark:bg-green-900'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                {hasPhoto ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-gray-500">3</span>
                )}
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Take Dashboard Photo
              </label>
            </div>

            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-400">
              <AlertCircle className="w-4 h-4 inline-block mr-1 text-blue-500" />
              This photo helps the AI learn where your odometer and fuel gauge are located.
            </div>

            {/* Camera/Photo area */}
            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
              {isCapturing ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Capture button overlay */}
                  <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="p-4 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
                    >
                      <Camera className="w-8 h-8 text-gray-900" />
                    </button>
                  </div>
                </>
              ) : dashboardPhoto ? (
                <>
                  <img
                    src={dashboardPhoto}
                    alt="Dashboard"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={retakePhoto}
                    className="absolute bottom-4 right-4 px-4 py-2 bg-white/90 rounded-lg shadow
                             flex items-center gap-2 text-gray-900 font-medium hover:bg-white"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retake
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  {cameraError ? (
                    <div className="text-center p-4">
                      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                      <p className="text-red-400 text-sm">{cameraError}</p>
                      <button
                        type="button"
                        onClick={startCamera}
                        className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="flex flex-col items-center gap-2 text-gray-400 hover:text-gray-300"
                    >
                      <div className="p-4 bg-gray-800 rounded-full">
                        <Camera className="w-8 h-8" />
                      </div>
                      <span className="text-sm font-medium">Tap to open camera</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Completion Status */}
          <div className={`p-4 rounded-lg ${
            canComplete
              ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800'
              : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
          }`}>
            <div className="flex items-center gap-3">
              {canComplete ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-300">
                    All steps complete - ready to proceed!
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Complete all steps to continue
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Complete Button */}
          <button
            type="button"
            onClick={handleComplete}
            disabled={!canComplete}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
              canComplete
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            Complete Setup
          </button>

          {/* Note about mandatory nature */}
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Setup by: {driverName}
          </p>
        </div>
      </div>
    </div>
  );
}

export default VehicleCalibrationModal;
