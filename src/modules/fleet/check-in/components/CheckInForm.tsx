/**
 * CheckInForm Component
 * Main check-in form for drivers (mobile-first)
 */

import React from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Car,
  Gauge,
} from 'lucide-react';
import { CheckInItemRow } from './CheckInItemRow';
import { CheckInPhotoGrid } from './CheckInPhotoGrid';
import { OfflineIndicator } from './OfflineIndicator';
import { useCheckIn } from '../hooks/useCheckIn';
import type { CheckRecord, CheckPhotoType } from '../../types/check-in.types';

interface CheckInFormProps {
  vehicleId: string;
  vehicleRegistration: string;
  driverId: string;
  driverName: string;
  onComplete: (record: CheckRecord) => void;
  onCancel: () => void;
}

export function CheckInForm({
  vehicleId,
  vehicleRegistration,
  driverId,
  driverName,
  onComplete,
  onCancel,
}: CheckInFormProps) {
  const {
    template,
    formState,
    isLoading,
    isSubmitting,
    error,
    setOdometerReading,
    setItemResponse,
    setPhoto,
    removePhoto,
    submit,
    canSubmit,
    validationErrors,
    hasCriticalFailures,
    hasMinorFailures,
  } = useCheckIn({
    vehicleId,
    driverId,
    driverName,
  });

  const handleSubmit = async () => {
    const record = await submit();
    if (record) {
      onComplete(record);
    }
  };

  // Group items by category
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

  const categoryOrder = ['safety', 'mechanical', 'exterior', 'interior', 'other'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-600 dark:text-gray-400">Loading checklist...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Offline indicator */}
      <OfflineIndicator />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b dark:border-gray-800 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Car className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              Vehicle Check-In
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {vehicleRegistration}
            </p>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Odometer reading */}
      <div className="px-4 mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          <Gauge className="w-4 h-4 inline mr-2" />
          Odometer Reading (km)
        </label>
        <input
          type="number"
          value={formState.odometerReading}
          onChange={(e) => setOdometerReading(e.target.value)}
          placeholder="Enter current odometer reading"
          className="w-full px-4 py-3 border rounded-lg text-lg bg-white dark:bg-gray-800 dark:border-gray-700 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Checklist items by category */}
      <div className="px-4 space-y-6">
        {categoryOrder.map((category) => {
          const items = itemsByCategory[category];
          if (!items || items.length === 0) return null;

          return (
            <div key={category}>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                {categoryLabels[category]}
              </h3>
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

      {/* Photo capture */}
      <div className="px-4 mt-6">
        <CheckInPhotoGrid
          photos={formState.photos}
          onPhotoCapture={(type, dataUrl, file) => setPhoto(type as CheckPhotoType, dataUrl, file)}
          onPhotoRemove={removePhoto}
          hasDamage={hasMinorFailures || hasCriticalFailures}
        />
      </div>

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
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {validationErrors.join(' • ')}
            </p>
          </div>
        </div>
      )}

      {/* Submit buttons - fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 px-4 border rounded-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
            canSubmit && !isSubmitting
              ? hasCriticalFailures
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600'
          }`}
        >
          {isSubmitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle className="w-5 h-5" />
          )}
          {isSubmitting ? 'Submitting...' : 'Submit Check-In'}
        </button>
      </div>
    </div>
  );
}
