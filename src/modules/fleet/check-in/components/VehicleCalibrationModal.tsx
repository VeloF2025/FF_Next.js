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

  // File input ref (uses native camera — no getUserMedia permission needed)
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Validation
  const odometerValue = parseInt(odometer, 10);
  const isValidOdometer = !isNaN(odometerValue) && odometerValue >= 0;
  const isValidFuel = fuelLevel !== null;
  const hasPhoto = !!dashboardPhoto;

  const canComplete = isValidOdometer && isValidFuel && hasPhoto;

  // Compress photo to max 1280px wide, JPEG 0.85 quality (matches old getUserMedia output)
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
    setDashboardPhoto(dataUrl);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [compressPhoto]);

  // Open native camera
  const openCamera = useCallback(() => {
    cameraInputRef.current?.click();
  }, []);

  // Retake photo
  const retakePhoto = useCallback(() => {
    setDashboardPhoto(null);
    cameraInputRef.current?.click();
  }, []);

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
      <div className="bg-background rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-border bg-blue-50 dark:bg-blue-900/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
              <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
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
          <div className="bg-input rounded-lg p-3">
            <p className="text-sm text-muted-foreground">Vehicle</p>
            <p className="text-lg font-bold text-foreground">
              {vehicleRegistration}
            </p>
            {(vehicleMake || vehicleModel) && (
              <p className="text-sm text-muted-foreground">
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
                  : 'bg-secondary'
              }`}>
                {isValidOdometer ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-muted-foreground">1</span>
                )}
              </div>
              <label className="text-sm font-medium text-muted-foreground">
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
                className="w-full pl-10 pr-16 py-3 border-2 border-border rounded-lg
                         bg-card text-foreground text-lg font-medium
                         focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
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
                  : 'bg-secondary'
              }`}>
                {isValidFuel ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-muted-foreground">2</span>
                )}
              </div>
              <label className="text-sm font-medium text-muted-foreground">
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
                      : 'border-border bg-card text-muted-foreground hover:border-border'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
            {fuelLevel !== null && (
              <div className="flex items-center gap-2 mt-2">
                <Fuel className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">
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
                  : 'bg-secondary'
              }`}>
                {hasPhoto ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-muted-foreground">3</span>
                )}
              </div>
              <label className="text-sm font-medium text-muted-foreground">
                Take Dashboard Photo
              </label>
            </div>

            <div className="bg-secondary rounded-lg p-3 text-sm text-muted-foreground">
              <AlertCircle className="w-4 h-4 inline-block mr-1 text-blue-500" />
              This photo helps the AI learn where your odometer and fuel gauge are located.
            </div>

            {/* Hidden file input — triggers native camera (no getUserMedia permission needed) */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
            />

            {/* Photo area */}
            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
              {dashboardPhoto ? (
                <>
                  <img
                    src={dashboardPhoto}
                    alt="Dashboard"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={retakePhoto}
                    className="absolute bottom-4 right-4 px-4 py-2 bg-card/90 rounded-lg shadow
                             flex items-center gap-2 text-foreground font-medium hover:bg-card"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retake
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <button
                    type="button"
                    onClick={openCamera}
                    className="flex flex-col items-center gap-2 text-gray-400 hover:text-gray-300"
                  >
                    <div className="p-4 bg-gray-800 rounded-full">
                      <Camera className="w-8 h-8" />
                    </div>
                    <span className="text-sm font-medium">Tap to take photo</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Completion Status */}
          <div className={`p-4 rounded-lg ${
            canComplete
              ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800'
              : 'bg-input border border-border'
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
                  <span className="text-sm text-muted-foreground">
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
                : 'bg-secondary text-gray-400 cursor-not-allowed'
            }`}
          >
            Complete Setup
          </button>

          {/* Note about mandatory nature */}
          <p className="text-xs text-center text-muted-foreground">
            Setup by: {driverName}
          </p>
        </div>
      </div>
    </div>
  );
}

export default VehicleCalibrationModal;
