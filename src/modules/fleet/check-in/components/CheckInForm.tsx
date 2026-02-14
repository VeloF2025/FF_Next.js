/**
 * CheckInForm Component
 * Main check-in form for drivers (mobile-first) with daily/weekly modes
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Car,
  Gauge,
  Calendar,
  CalendarDays,
  Fuel,
} from 'lucide-react';
import { CheckInItemRow } from './CheckInItemRow';
import { CheckInPhotoGridEnhanced } from './CheckInPhotoGridEnhanced';
import { OfflineIndicator } from './OfflineIndicator';
import { VlmResultCard } from './VlmResultCard';
import { OdometerOverrideModal } from './OdometerOverrideModal';
import { useCheckIn } from '../hooks/useCheckIn';
import type { CheckRecord, CheckPhotoType, CheckType } from '../../types/check-in.types';

interface CheckInFormProps {
  vehicleId: string;
  vehicleRegistration: string;
  driverId: string;
  driverName: string;
  initialCheckType?: CheckType;
  onComplete: (record: CheckRecord) => void;
  onCancel: () => void;
}

export function CheckInForm({
  vehicleId,
  vehicleRegistration,
  driverId,
  driverName,
  initialCheckType,
  onComplete,
  onCancel,
}: CheckInFormProps) {
  // Modal state for odometer override
  const [showOdometerOverrideModal, setShowOdometerOverrideModal] = useState(false);

  const {
    template,
    formState,
    isLoading,
    isSubmitting,
    error,
    checkType,
    vlmResults,
    isProcessingVlm,
    // Last confirmed readings
    lastOdometer,
    lastFuel,
    isLoadingLastReadings,
    // Anomaly detection
    odometerAnomaly,
    fuelAnomaly,
    // Override confirmations
    odometerOverrideConfirmed,
    fuelOverrideConfirmed,
    confirmOdometerOverride,
    confirmFuelOverride,
    // Verified override (with photo proof)
    odometerVerifiedOverride,
    setOdometerVerifiedOverride,
    setCheckType,
    setOdometerReading,
    setFuelLevel,
    setItemResponse,
    setPhoto,
    removePhoto,
    overrideVlmValue,
    processPhotoWithVlm,
    submit,
    canSubmit,
    validationErrors,
    hasCriticalFailures,
    hasMinorFailures,
    requiredPhotos,
  } = useCheckIn({
    vehicleId,
    vehicleRegistration,
    driverId,
    driverName,
    initialCheckType,
  });

  const handleSubmit = async () => {
    const record = await submit();
    if (record) {
      onComplete(record);
    }
  };

  // Handle odometer override modal confirmation
  const handleOdometerOverrideConfirm = (manualReading: number, verificationPhotoDataUrl: string) => {
    setOdometerVerifiedOverride(manualReading, verificationPhotoDataUrl);
    setShowOdometerOverrideModal(false);
  };

  // Handle photo capture with auto-VLM processing
  const handlePhotoCapture = async (type: CheckPhotoType, dataUrl: string, file?: File, latitude?: number | null, longitude?: number | null) => {
    setPhoto(type, dataUrl, file, latitude, longitude);
    // Auto-process VLM for dashboard and fuel_gauge photos
    const photoConfig = requiredPhotos.find(p => p.type === type);
    if (photoConfig?.vlmType) {
      // Pass dataUrl directly to avoid stale state issues
      processPhotoWithVlm(type, dataUrl);
    }
  };

  // Handle check type change with confirmation if photos exist
  const handleCheckTypeChange = (newType: CheckType) => {
    // Don't do anything if already on this type
    if (newType === checkType) return;

    // If there are photos, warn the user
    const hasPhotos = formState.photos.size > 0;
    if (hasPhotos) {
      const confirmed = window.confirm(
        `Switching to ${newType === 'daily' ? 'Daily' : 'Weekly'} check will clear your captured photos. Continue?`
      );
      if (!confirmed) return;
    }

    setCheckType(newType);
  };

  // Group items by category (only for weekly checks)
  const itemsByCategory = template?.items.reduce((acc, item) => {
    const category = item.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof template.items>) || {};

  const categoryLabels: Record<string, string> = {
    safety: 'Safety Checks',
    mechanical: 'Mechanical',
    exterior: 'Exterior',
    interior: 'Interior',
    other: 'Other',
  };

  const categoryOrder = ['safety', 'exterior', 'interior', 'mechanical', 'other'];

  // Get VLM result for odometer
  const odometerVlm = vlmResults.get('dashboard');
  const fuelVlm = vlmResults.get('fuel_gauge');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-muted-foreground">Loading checklist...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Offline indicator */}
      <OfflineIndicator />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b dark:border-gray-800 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">
              Vehicle Check-In
            </h1>
            <p className="text-sm text-muted-foreground">
              {vehicleRegistration}
            </p>
          </div>
        </div>

        {/* Check Type Toggle */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => handleCheckTypeChange('daily')}
            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors ${
              checkType === 'daily'
                ? 'bg-blue-500 text-white'
                : 'bg-secondary text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Daily
          </button>
          <button
            type="button"
            onClick={() => handleCheckTypeChange('weekly')}
            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors ${
              checkType === 'weekly'
                ? 'bg-purple-500 text-white'
                : 'bg-secondary text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            Weekly
          </button>
        </div>

        {/* Check type description */}
        <p className="mt-2 text-xs text-muted-foreground">
          {checkType === 'daily'
            ? 'Quick check: Odometer + Fuel photos only'
            : 'Full inspection: Complete checklist + all photos'
          }
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Photo capture - shown first for both modes */}
      <div className="px-4 mb-6">
        <h3 className="font-medium text-foreground mb-3">
          {checkType === 'daily' ? 'Required Photos' : 'Vehicle Photos'}
        </h3>
        <CheckInPhotoGridEnhanced
          photos={formState.photos}
          requiredPhotos={requiredPhotos}
          vlmResults={vlmResults}
          onPhotoCapture={handlePhotoCapture}
          onPhotoRemove={removePhoto}
          hasDamage={hasMinorFailures || hasCriticalFailures}
        />
      </div>

      {/* Last Confirmed Readings */}
      {(lastOdometer || lastFuel) && !isLoadingLastReadings && (
        <div className="px-4 mb-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
              Previous Readings
            </h4>
            <div className="flex flex-wrap gap-4 text-sm">
              {lastOdometer && (
                <div>
                  <span className="text-blue-600 dark:text-blue-400">Odometer: </span>
                  <span className="font-semibold text-blue-900 dark:text-blue-200">
                    {lastOdometer.value.toLocaleString()} km
                  </span>
                  <span className="text-blue-500 dark:text-blue-400 text-xs ml-1">
                    ({new Date(lastOdometer.recordedAt).toISOString().split('T')[0]})
                  </span>
                </div>
              )}
              {lastFuel && (
                <div>
                  <span className="text-blue-600 dark:text-blue-400">Fuel: </span>
                  <span className="font-semibold text-blue-900 dark:text-blue-200">
                    {lastFuel.value}%
                  </span>
                  <span className="text-blue-500 dark:text-blue-400 text-xs ml-1">
                    ({new Date(lastFuel.recordedAt).toISOString().split('T')[0]})
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VLM Results Cards */}
      {(odometerVlm || fuelVlm) && (
        <div className="px-4 mb-6 space-y-3">
          {odometerVlm && (
            <VlmResultCard
              title="Odometer Reading"
              icon={<Gauge className="w-5 h-5" />}
              vlmResult={odometerVlm}
              currentValue={formState.odometerReading}
              unit="km"
              onOverride={(value) => overrideVlmValue('dashboard', value)}
              onRequestVerifiedOverride={() => setShowOdometerOverrideModal(true)}
              hasVerifiedOverride={odometerVerifiedOverride}
            />
          )}
          {fuelVlm && (
            <VlmResultCard
              title="Fuel Level"
              icon={<Fuel className="w-5 h-5" />}
              vlmResult={fuelVlm}
              currentValue={formState.fuelLevel}
              unit="%"
              onOverride={(value) => overrideVlmValue('fuel_gauge', value)}
            />
          )}
        </div>
      )}

      {/* Anomaly Warnings with Confirm Buttons */}
      {(odometerAnomaly || fuelAnomaly) && (
        <div className="px-4 mb-6 space-y-3">
          {odometerAnomaly && !odometerOverrideConfirmed && (
            <div className={`p-4 rounded-lg border ${
              odometerAnomaly.severity === 'high'
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
            }`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  odometerAnomaly.severity === 'high' ? 'text-red-500' : 'text-amber-500'
                }`} />
                <div className="flex-1">
                  <p className={`font-medium ${
                    odometerAnomaly.severity === 'high'
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}>
                    Odometer Anomaly Detected
                  </p>
                  <p className={`text-sm mt-1 ${
                    odometerAnomaly.severity === 'high'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    {odometerAnomaly.warning}
                  </p>
                  <button
                    type="button"
                    onClick={confirmOdometerOverride}
                    className={`mt-3 px-4 py-2 text-sm font-medium rounded-lg ${
                      odometerAnomaly.severity === 'high'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-800 dark:text-red-200 dark:hover:bg-red-700'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-800 dark:text-amber-200 dark:hover:bg-amber-700'
                    }`}
                  >
                    I confirm this reading is correct
                  </button>
                </div>
              </div>
            </div>
          )}

          {fuelAnomaly && !fuelOverrideConfirmed && (
            <div className={`p-4 rounded-lg border ${
              fuelAnomaly.severity === 'high'
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
            }`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  fuelAnomaly.severity === 'high' ? 'text-red-500' : 'text-amber-500'
                }`} />
                <div className="flex-1">
                  <p className={`font-medium ${
                    fuelAnomaly.severity === 'high'
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}>
                    Fuel Level Anomaly Detected
                  </p>
                  <p className={`text-sm mt-1 ${
                    fuelAnomaly.severity === 'high'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    {fuelAnomaly.warning}
                  </p>
                  <button
                    type="button"
                    onClick={confirmFuelOverride}
                    className={`mt-3 px-4 py-2 text-sm font-medium rounded-lg ${
                      fuelAnomaly.severity === 'high'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-800 dark:text-red-200 dark:hover:bg-red-700'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-800 dark:text-amber-200 dark:hover:bg-amber-700'
                    }`}
                  >
                    I confirm this reading is correct
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Odometer Entry (fallback) */}
      {!odometerVlm?.extractedNumeric && (
        <div className="px-4 mb-6">
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            <Gauge className="w-4 h-4 inline mr-2" />
            Odometer Reading (km)
          </label>
          <input
            type="number"
            value={formState.odometerReading}
            onChange={(e) => setOdometerReading(e.target.value)}
            placeholder="Enter current odometer reading"
            className="w-full px-4 py-3 border rounded-lg text-lg bg-card dark:border-gray-700 focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {isProcessingVlm ? 'Processing photo...' : 'Or take a dashboard photo to auto-fill'}
          </p>
        </div>
      )}

      {/* Weekly Checklist items by category */}
      {checkType === 'weekly' && template?.items && template.items.length > 0 && (
        <div className="px-4 space-y-6 mt-6">
          <h3 className="font-medium text-foreground">Inspection Checklist</h3>
          {categoryOrder.map((category) => {
            const items = itemsByCategory[category];
            if (!items || items.length === 0) return null;

            return (
              <div key={category}>
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide mb-3">
                  {categoryLabels[category]}
                </h4>
                <div className="space-y-3">
                  {items.map((item) => (
                    <CheckInItemRow
                      key={item.id}
                      item={item}
                      response={formState.responses.get(item.id)}
                      onResponse={setItemResponse}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary & warnings */}
      {(hasCriticalFailures || hasMinorFailures) && (
        <div className="px-4 mt-6">
          {hasCriticalFailures && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-400">
                    Critical Issues Found
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    Vehicle cannot be used until issues are resolved.
                  </p>
                </div>
              </div>
            </div>
          )}
          {hasMinorFailures && !hasCriticalFailures && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Minor Issues Found
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                    Vehicle can be used but issues should be addressed soon.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="px-4 mt-4">
          <div className="p-3 bg-input rounded-lg">
            <p className="text-sm text-muted-foreground">
              {validationErrors.join(' • ')}
            </p>
          </div>
        </div>
      )}

      {/* Submit buttons - fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t dark:border-gray-800 p-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 px-4 border rounded-lg font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting || isProcessingVlm}
          className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
            canSubmit && !isSubmitting && !isProcessingVlm
              ? hasCriticalFailures
                ? 'bg-red-500 text-white hover:bg-red-600'
                : checkType === 'daily'
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-purple-500 text-white hover:bg-purple-600'
              : 'bg-secondary text-muted-foreground cursor-not-allowed dark:bg-gray-800 dark:text-muted-foreground'
          }`}
        >
          {isSubmitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isProcessingVlm ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle className="w-5 h-5" />
          )}
          {isSubmitting ? 'Submitting...' : isProcessingVlm ? 'Processing...' : `Submit ${checkType === 'daily' ? 'Daily' : 'Weekly'} Check`}
        </button>
      </div>

      {/* Odometer Override Modal - for rejected VLM readings */}
      <OdometerOverrideModal
        isOpen={showOdometerOverrideModal}
        onClose={() => setShowOdometerOverrideModal(false)}
        onConfirm={handleOdometerOverrideConfirm}
        rejectionReason={odometerVlm?.validation?.warning || 'Reading validation failed'}
        vlmExtractedValue={odometerVlm?.extractedNumeric ?? null}
        previousReading={lastOdometer?.value ?? null}
        vehicleRegistration={vehicleRegistration}
      />
    </div>
  );
}
