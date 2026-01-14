/**
 * useCheckIn Hook
 * Manages check-in form state and submission
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  CheckTemplateWithItems,
  CheckItem,
  CreateCheckResponseInput,
  CreateCheckRecordInput,
  CheckRecord,
  CheckPhotoType,
} from '../../types/check-in.types';
import { offlineStorage } from '../utils/offlineStorage';

interface CheckInFormState {
  vehicleId: string;
  templateId: string | null;
  odometerReading: string;
  responses: Map<string, CreateCheckResponseInput>;
  photos: Map<CheckPhotoType, { dataUrl: string; file?: File }>;
}

interface UseCheckInOptions {
  vehicleId: string;
  driverId: string;
  driverName: string;
}

interface UseCheckInReturn {
  // State
  template: CheckTemplateWithItems | null;
  formState: CheckInFormState;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;

  // Form handlers
  setOdometerReading: (value: string) => void;
  setItemResponse: (itemId: string, isPassed: boolean, notes?: string) => void;
  setPhoto: (type: CheckPhotoType, dataUrl: string, file?: File) => void;
  removePhoto: (type: CheckPhotoType) => void;

  // Actions
  loadTemplate: (templateId?: string) => Promise<void>;
  submit: () => Promise<CheckRecord | null>;
  reset: () => void;

  // Validation
  canSubmit: boolean;
  validationErrors: string[];
  hasCriticalFailures: boolean;
  hasMinorFailures: boolean;
}

export function useCheckIn(options: UseCheckInOptions): UseCheckInReturn {
  const { vehicleId, driverId, driverName } = options;

  // State
  const [template, setTemplate] = useState<CheckTemplateWithItems | null>(null);
  const [formState, setFormState] = useState<CheckInFormState>({
    vehicleId,
    templateId: null,
    odometerReading: '',
    responses: new Map(),
    photos: new Map(),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load template
  const loadTemplate = useCallback(async (templateId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const url = templateId
        ? `/api/fleet/check-in/templates/${templateId}`
        : '/api/fleet/check-in/templates?default=true';

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load template');
      }

      const templateData = data.data || data;
      setTemplate(templateData);
      setFormState(prev => ({
        ...prev,
        templateId: templateData.id,
        responses: new Map(), // Reset responses for new template
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Form handlers
  const setOdometerReading = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, odometerReading: value }));
  }, []);

  const setItemResponse = useCallback((itemId: string, isPassed: boolean, notes?: string) => {
    setFormState(prev => {
      const newResponses = new Map(prev.responses);
      const item = template?.items.find(i => i.id === itemId);

      newResponses.set(itemId, {
        itemId,
        isPassed,
        severity: isPassed ? undefined : (item?.isCritical ? 'critical' : 'minor'),
        notes,
      });

      return { ...prev, responses: newResponses };
    });
  }, [template]);

  const setPhoto = useCallback((type: CheckPhotoType, dataUrl: string, file?: File) => {
    setFormState(prev => {
      const newPhotos = new Map(prev.photos);
      newPhotos.set(type, { dataUrl, file });
      return { ...prev, photos: newPhotos };
    });
  }, []);

  const removePhoto = useCallback((type: CheckPhotoType) => {
    setFormState(prev => {
      const newPhotos = new Map(prev.photos);
      newPhotos.delete(type);
      return { ...prev, photos: newPhotos };
    });
  }, []);

  // Validation
  const validationErrors: string[] = [];

  // Check all items have responses
  const unansweredItems = template?.items.filter(item => !formState.responses.has(item.id)) || [];
  if (unansweredItems.length > 0) {
    validationErrors.push(`${unansweredItems.length} items not checked`);
  }

  // Check required photos
  const requiredPhotos: CheckPhotoType[] = ['front', 'rear', 'dashboard'];
  const missingPhotos = requiredPhotos.filter(type => !formState.photos.has(type));
  if (missingPhotos.length > 0) {
    validationErrors.push(`Missing required photos: ${missingPhotos.join(', ')}`);
  }

  // Check failures
  const responses = Array.from(formState.responses.values());
  const hasCriticalFailures = responses.some(r => !r.isPassed && r.severity === 'critical');
  const hasMinorFailures = responses.some(r => !r.isPassed && r.severity === 'minor');

  const canSubmit = validationErrors.length === 0 && template !== null;

  // Submit handler
  const submit = useCallback(async (): Promise<CheckRecord | null> => {
    if (!canSubmit || !template) return null;

    setIsSubmitting(true);
    setError(null);

    try {
      const isOnline = navigator.onLine;

      // Prepare input
      const input: CreateCheckRecordInput = {
        vehicleId: formState.vehicleId,
        templateId: formState.templateId || undefined,
        driverId,
        driverName,
        odometerReading: formState.odometerReading ? parseInt(formState.odometerReading, 10) : undefined,
        responses: Array.from(formState.responses.values()),
      };

      if (!isOnline) {
        // Save offline
        const offlineRecord = await offlineStorage.saveOfflineRecord({
          vehicleId: input.vehicleId,
          templateId: input.templateId || null,
          driverId: input.driverId,
          driverName: input.driverName,
          odometerReading: input.odometerReading || null,
          responses: input.responses,
        });

        // Save photos offline
        for (const [type, photo] of formState.photos.entries()) {
          await offlineStorage.saveOfflinePhoto(offlineRecord.offlineId, {
            photoType: type,
            dataUrl: photo.dataUrl,
            latitude: null,
            longitude: null,
          });
        }

        // Return a mock record for UI
        return {
          id: offlineRecord.offlineId,
          vehicleId: input.vehicleId,
          templateId: input.templateId || null,
          driverId: input.driverId,
          driverName: input.driverName,
          checkDate: offlineRecord.checkDate,
          checkTime: offlineRecord.checkTime,
          odometerReading: input.odometerReading || null,
          status: 'pending',
          hasCriticalIssues: hasCriticalFailures,
          hasMinorIssues: hasMinorFailures,
          approvedBy: null,
          approvedAt: null,
          approvalNotes: null,
          syncStatus: 'pending',
          offlineId: offlineRecord.offlineId,
          createdAt: offlineRecord.createdAt,
          updatedAt: offlineRecord.createdAt,
        };
      }

      // Submit online
      const response = await fetch('/api/fleet/check-in/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit check-in');
      }

      const record = (data.data || data) as CheckRecord;

      // Upload photos
      for (const [type, photo] of formState.photos.entries()) {
        if (photo.file) {
          const formData = new FormData();
          formData.append('recordId', record.id);
          formData.append('photoType', type);
          formData.append('file', photo.file);

          await fetch('/api/fleet/check-in/photos', {
            method: 'POST',
            body: formData,
          });
        }
      }

      return record;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit check-in');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, template, formState, driverId, driverName, hasCriticalFailures, hasMinorFailures]);

  // Reset form
  const reset = useCallback(() => {
    setFormState({
      vehicleId,
      templateId: template?.id || null,
      odometerReading: '',
      responses: new Map(),
      photos: new Map(),
    });
    setError(null);
  }, [vehicleId, template]);

  // Load default template on mount
  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  return {
    template,
    formState,
    isLoading,
    isSubmitting,
    error,
    setOdometerReading,
    setItemResponse,
    setPhoto,
    removePhoto,
    loadTemplate,
    submit,
    reset,
    canSubmit,
    validationErrors,
    hasCriticalFailures,
    hasMinorFailures,
  };
}
