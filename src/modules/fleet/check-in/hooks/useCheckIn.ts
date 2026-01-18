/**
 * useCheckIn Hook
 * Manages check-in form state and submission with daily/weekly modes
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  CheckTemplateWithItems,
  CreateCheckResponseInput,
  CreateCheckRecordInput,
  CheckRecord,
  CheckPhotoType,
  CheckType,
  VlmPhotoResult,
  VlmAnalysisType,
  DAILY_REQUIRED_PHOTOS,
  WEEKLY_REQUIRED_PHOTOS,
} from '../../types/check-in.types';
import { offlineStorage } from '../utils/offlineStorage';

// Import the required photo configs
const DAILY_PHOTOS = [
  { type: 'dashboard' as CheckPhotoType, label: 'Dashboard/Odometer', required: true, vlmType: 'odometer' as VlmAnalysisType },
  { type: 'fuel_gauge' as CheckPhotoType, label: 'Fuel Gauge', required: true, vlmType: 'fuel_gauge' as VlmAnalysisType },
];

const WEEKLY_PHOTOS = [
  { type: 'front' as CheckPhotoType, label: 'Exterior Front (License Plate)', required: true, vlmType: 'license_plate' as VlmAnalysisType },
  { type: 'rear' as CheckPhotoType, label: 'Exterior Rear (License Plate)', required: true, vlmType: 'license_plate' as VlmAnalysisType },
  { type: 'dashboard' as CheckPhotoType, label: 'Dashboard/Odometer', required: true, vlmType: 'odometer' as VlmAnalysisType },
  { type: 'fuel_gauge' as CheckPhotoType, label: 'Fuel Gauge', required: true, vlmType: 'fuel_gauge' as VlmAnalysisType },
  { type: 'under_vehicle' as CheckPhotoType, label: 'Under Vehicle (Leaks)', required: false },
  { type: 'license_disk' as CheckPhotoType, label: 'License Disk', required: false },
  { type: 'damage' as CheckPhotoType, label: 'Damage Photos', required: false },
];

interface PhotoData {
  dataUrl: string;
  file?: File;
}

interface CheckInFormState {
  vehicleId: string;
  templateId: string | null;
  checkType: CheckType;
  odometerReading: string;
  fuelLevel: string;
  responses: Map<string, CreateCheckResponseInput>;
  photos: Map<CheckPhotoType, PhotoData>;
}

interface VlmValidation {
  suggestedAction: 'accept' | 'review' | 'reject';
  warning?: string;
}

interface LastReading {
  value: number;
  recordedAt: string;
  source: 'vlm' | 'manual';
}

interface ReadingAnomaly {
  type: 'odometer' | 'fuel';
  currentValue: number;
  lastValue: number;
  difference: number;
  percentChange: number;
  warning: string;
  severity: 'low' | 'medium' | 'high';
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
  validation?: VlmValidation;
}

interface UseCheckInOptions {
  vehicleId: string;
  vehicleRegistration?: string; // For license plate verification
  driverId: string;
  driverName: string;
  initialCheckType?: CheckType;
}

interface UseCheckInReturn {
  // State
  template: CheckTemplateWithItems | null;
  formState: CheckInFormState;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  checkType: CheckType;

  // VLM state
  vlmResults: Map<CheckPhotoType, VlmResult>;
  isProcessingVlm: boolean;

  // Last confirmed readings (for display)
  lastOdometer: LastReading | null;
  lastFuel: LastReading | null;
  isLoadingLastReadings: boolean;

  // Anomaly detection
  odometerAnomaly: ReadingAnomaly | null;
  fuelAnomaly: ReadingAnomaly | null;

  // Manual override tracking
  odometerOverrideConfirmed: boolean;
  fuelOverrideConfirmed: boolean;

  // Form handlers
  setCheckType: (type: CheckType) => void;
  setOdometerReading: (value: string) => void;
  setFuelLevel: (value: string) => void;
  setItemResponse: (itemId: string, isPassed: boolean, notes?: string) => void;
  setPhoto: (type: CheckPhotoType, dataUrl: string, file?: File) => void;
  removePhoto: (type: CheckPhotoType) => void;
  overrideVlmValue: (photoType: CheckPhotoType, value: string | number) => void;
  confirmOdometerOverride: () => void;
  confirmFuelOverride: () => void;

  // Actions
  loadTemplate: (checkType?: CheckType, templateId?: string) => Promise<void>;
  processPhotoWithVlm: (type: CheckPhotoType, photoDataUrl?: string) => Promise<void>;
  submit: () => Promise<CheckRecord | null>;
  reset: () => void;

  // Validation
  canSubmit: boolean;
  validationErrors: string[];
  hasCriticalFailures: boolean;
  hasMinorFailures: boolean;

  // Photo requirements
  requiredPhotos: typeof DAILY_PHOTOS | typeof WEEKLY_PHOTOS;
}

export function useCheckIn(options: UseCheckInOptions): UseCheckInReturn {
  const { vehicleId, vehicleRegistration, driverId, driverName, initialCheckType = 'daily' } = options;

  // State
  const [template, setTemplate] = useState<CheckTemplateWithItems | null>(null);
  const [checkType, setCheckTypeState] = useState<CheckType>(initialCheckType);
  const [formState, setFormState] = useState<CheckInFormState>({
    vehicleId,
    templateId: null,
    checkType: initialCheckType,
    odometerReading: '',
    fuelLevel: '',
    responses: new Map(),
    photos: new Map(),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VLM state
  const [vlmResults, setVlmResults] = useState<Map<CheckPhotoType, VlmResult>>(new Map());
  const [isProcessingVlm, setIsProcessingVlm] = useState(false);

  // Last confirmed readings state
  const [lastOdometer, setLastOdometer] = useState<LastReading | null>(null);
  const [lastFuel, setLastFuel] = useState<LastReading | null>(null);
  const [isLoadingLastReadings, setIsLoadingLastReadings] = useState(false);

  // Manual override confirmation state
  const [odometerOverrideConfirmed, setOdometerOverrideConfirmed] = useState(false);
  const [fuelOverrideConfirmed, setFuelOverrideConfirmed] = useState(false);

  // Get required photos based on check type
  const requiredPhotos = checkType === 'daily' ? DAILY_PHOTOS : WEEKLY_PHOTOS;

  // Load template by check type
  const loadTemplate = useCallback(async (type?: CheckType, templateId?: string) => {
    setIsLoading(true);
    setError(null);

    const targetType = type || checkType;

    try {
      let url: string;
      if (templateId) {
        url = `/api/fleet/check-in/templates/${templateId}`;
      } else {
        url = `/api/fleet/check-in/templates?default=true&checkType=${targetType}`;
      }

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
        checkType: targetType,
        responses: new Map(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setIsLoading(false);
    }
  }, [checkType]);

  // Change check type
  const setCheckType = useCallback((type: CheckType) => {
    setCheckTypeState(type);
    setFormState(prev => ({
      ...prev,
      checkType: type,
      responses: new Map(),
      photos: new Map(),
    }));
    setVlmResults(new Map());
    // Reload template for new type
    loadTemplate(type);
  }, [loadTemplate]);

  // Form handlers
  const setOdometerReading = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, odometerReading: value }));
    // Reset override confirmation when value changes
    setOdometerOverrideConfirmed(false);
  }, []);

  const setFuelLevel = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, fuelLevel: value }));
    // Reset override confirmation when value changes
    setFuelOverrideConfirmed(false);
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
    // Also remove VLM result
    setVlmResults(prev => {
      const newResults = new Map(prev);
      newResults.delete(type);
      return newResults;
    });
  }, []);

  // Override VLM extracted value with manual entry
  const overrideVlmValue = useCallback((photoType: CheckPhotoType, value: string | number) => {
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value;

    // Update the appropriate field
    if (photoType === 'dashboard') {
      setFormState(prev => ({ ...prev, odometerReading: String(numValue) }));
    } else if (photoType === 'fuel_gauge') {
      setFormState(prev => ({ ...prev, fuelLevel: String(numValue) }));
    }

    // Mark VLM result as overridden
    setVlmResults(prev => {
      const newResults = new Map(prev);
      const existing = newResults.get(photoType);
      if (existing) {
        newResults.set(photoType, {
          ...existing,
          extractedNumeric: numValue,
          extractedValue: String(numValue),
        });
      }
      return newResults;
    });
  }, []);

  // Process photo with VLM
  // photoDataUrl can be passed directly to avoid stale state issues from setTimeout
  const processPhotoWithVlm = useCallback(async (type: CheckPhotoType, photoDataUrl?: string) => {
    // Use passed dataUrl or fall back to state (for manual retriggers)
    const dataUrl = photoDataUrl || formState.photos.get(type)?.dataUrl;
    if (!dataUrl) return;

    // Find VLM type for this photo
    const photoConfig = requiredPhotos.find(p => p.type === type);
    if (!photoConfig?.vlmType) return;

    // Set processing state
    setVlmResults(prev => {
      const newResults = new Map(prev);
      newResults.set(type, {
        photoType: type,
        analysisType: photoConfig.vlmType!,
        extractedValue: null,
        extractedNumeric: null,
        confidence: 0,
        isProcessing: true,
      });
      return newResults;
    });
    setIsProcessingVlm(true);

    try {
      // Extract base64 from data URL
      const base64 = dataUrl.split(',')[1];

      const response = await fetch('/api/fleet/check-in/process-vlm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoId: `temp-${Date.now()}`, // Will be replaced after record creation
          recordId: 'pending',
          vehicleId,
          analysisType: photoConfig.vlmType,
          base64Image: base64,
          expectedPlate: vehicleRegistration,
        }),
      });

      const data = await response.json();

      // API wraps response in { success, data, meta } - extract the inner data
      const vlmData = data.data || data;

      if (vlmData.success && vlmData.result) {
        const result = vlmData.result;

        // Update VLM result with validation info
        setVlmResults(prev => {
          const newResults = new Map(prev);
          newResults.set(type, {
            photoType: type,
            analysisType: photoConfig.vlmType!,
            extractedValue: result.extractedValue,
            extractedNumeric: result.extractedNumeric,
            confidence: result.confidence,
            plateMatches: result.plateMatches,
            isProcessing: false,
            error: result.error,
            validation: result.validation,
          });
          return newResults;
        });

        // Auto-fill form fields from VLM
        if (result.extractedNumeric !== null && result.confidence > 0.5) {
          if (photoConfig.vlmType === 'odometer') {
            setFormState(prev => ({ ...prev, odometerReading: String(result.extractedNumeric) }));
          } else if (photoConfig.vlmType === 'fuel_gauge') {
            setFormState(prev => ({ ...prev, fuelLevel: String(result.extractedNumeric) }));
          }
        }
      } else {
        // VLM processing failed
        setVlmResults(prev => {
          const newResults = new Map(prev);
          newResults.set(type, {
            photoType: type,
            analysisType: photoConfig.vlmType!,
            extractedValue: null,
            extractedNumeric: null,
            confidence: 0,
            isProcessing: false,
            error: vlmData.result?.error || 'VLM processing failed',
          });
          return newResults;
        });
      }
    } catch (err) {
      setVlmResults(prev => {
        const newResults = new Map(prev);
        newResults.set(type, {
          photoType: type,
          analysisType: photoConfig.vlmType!,
          extractedValue: null,
          extractedNumeric: null,
          confidence: 0,
          isProcessing: false,
          error: err instanceof Error ? err.message : 'VLM processing failed',
        });
        return newResults;
      });
    } finally {
      setIsProcessingVlm(false);
    }
  }, [formState.photos, requiredPhotos, vehicleId, vehicleRegistration]);

  // Validation
  const validationErrors: string[] = [];

  // Check all items have responses (only for weekly checks with checklist items)
  if (checkType === 'weekly' && template?.items.length) {
    const unansweredItems = template.items.filter(item => !formState.responses.has(item.id));
    if (unansweredItems.length > 0) {
      validationErrors.push(`${unansweredItems.length} items not checked`);
    }
  }

  // Check required photos
  const requiredPhotoTypes = requiredPhotos.filter(p => p.required).map(p => p.type);
  const missingPhotos = requiredPhotoTypes.filter(type => !formState.photos.has(type));
  if (missingPhotos.length > 0) {
    const labels = missingPhotos.map(type => {
      const config = requiredPhotos.find(p => p.type === type);
      return config?.label || type;
    });
    validationErrors.push(`Missing: ${labels.join(', ')}`);
  }

  // Check odometer reading (required for both daily and weekly)
  if (!formState.odometerReading) {
    validationErrors.push('Odometer reading required');
  }

  // Check VLM validation results - block submission if readings are rejected
  for (const [photoType, vlmResult] of vlmResults.entries()) {
    if (vlmResult.validation?.suggestedAction === 'reject') {
      const label = requiredPhotos.find(p => p.type === photoType)?.label || photoType;
      validationErrors.push(`${label}: ${vlmResult.validation.warning || 'Reading rejected by validation'}`);
    }
    // Also warn about plate mismatches
    if (vlmResult.analysisType === 'license_plate' && vlmResult.plateMatches === false) {
      validationErrors.push('License plate does not match vehicle registration');
    }
  }

  // Check failures
  const responses = Array.from(formState.responses.values());
  const hasCriticalFailures = responses.some(r => !r.isPassed && r.severity === 'critical');
  const hasMinorFailures = responses.some(r => !r.isPassed && r.severity === 'minor');

  const canSubmit = validationErrors.length === 0;

  // Submit handler
  const submit = useCallback(async (): Promise<CheckRecord | null> => {
    if (!canSubmit) return null;

    setIsSubmitting(true);
    setError(null);

    try {
      const isOnline = navigator.onLine;

      // Prepare input
      const input: CreateCheckRecordInput = {
        vehicleId: formState.vehicleId,
        templateId: formState.templateId || undefined,
        checkType: formState.checkType,
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
          checkType: input.checkType,
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
          checkType: input.checkType || 'daily',
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

      // Upload photos and re-process VLM with real record ID
      for (const [type, photo] of formState.photos.entries()) {
        if (photo.file) {
          // Upload photo first
          const formData = new FormData();
          formData.append('recordId', record.id);
          formData.append('photoType', type);
          formData.append('file', photo.file);

          const uploadResponse = await fetch('/api/fleet/check-in/photos', {
            method: 'POST',
            body: formData,
          });

          // Get the photo ID from the upload response
          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            const photoId = uploadData.data?.id || uploadData.id;

            // Re-process VLM with real record/photo IDs to persist results
            const photoConfig = requiredPhotos.find(p => p.type === type);
            if (photoConfig?.vlmType && photoId && photo.dataUrl) {
              const base64 = photo.dataUrl.includes(',')
                ? photo.dataUrl.split(',')[1]
                : photo.dataUrl;

              if (base64) {
                // Fire and forget - don't block submission for VLM persistence
                fetch('/api/fleet/check-in/process-vlm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    photoId,
                    recordId: record.id,
                    vehicleId,
                    analysisType: photoConfig.vlmType,
                    base64Image: base64,
                    expectedPlate: vehicleRegistration,
                  }),
                })
                  .then(r => r.ok ? console.log(`VLM persisted for ${type}`) : console.error(`VLM persist failed for ${type}: ${r.status}`))
                  .catch(e => console.error(`VLM persist error for ${type}:`, e));
              } else {
                console.warn(`No base64 data for ${type} photo, skipping VLM persist`);
              }
            } else {
              console.warn(`Skipping VLM persist for ${type}: vlmType=${photoConfig?.vlmType}, photoId=${photoId}, hasDataUrl=${!!photo.dataUrl}`);
            }
          }
        }
      }

      return record;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit check-in');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, formState, driverId, driverName, hasCriticalFailures, hasMinorFailures, requiredPhotos, vehicleId, vehicleRegistration]);

  // Reset form
  const reset = useCallback(() => {
    setFormState({
      vehicleId,
      templateId: template?.id || null,
      checkType,
      odometerReading: '',
      fuelLevel: '',
      responses: new Map(),
      photos: new Map(),
    });
    setVlmResults(new Map());
    setError(null);
  }, [vehicleId, template, checkType]);

  // Load default template on mount
  useEffect(() => {
    loadTemplate(initialCheckType);
  }, [initialCheckType]); // Only run on mount

  // Fetch last confirmed readings on mount
  useEffect(() => {
    const fetchLastReadings = async () => {
      if (!vehicleId) return;

      setIsLoadingLastReadings(true);
      try {
        const response = await fetch(`/api/fleet/check-in/vehicle/${vehicleId}?lastReading=true`);
        if (response.ok) {
          const data = await response.json();
          const readings = data.data || data;

          if (readings.odometer) {
            setLastOdometer({
              value: readings.odometer.reading,
              recordedAt: readings.odometer.recordedAt,
              source: readings.odometer.source,
            });
          }

          if (readings.fuel) {
            setLastFuel({
              value: readings.fuel.level,
              recordedAt: readings.fuel.recordedAt,
              source: readings.fuel.source,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch last readings:', err);
      } finally {
        setIsLoadingLastReadings(false);
      }
    };

    fetchLastReadings();
  }, [vehicleId]);

  // Anomaly detection for odometer
  const odometerAnomaly = useMemo((): ReadingAnomaly | null => {
    const currentValue = parseInt(formState.odometerReading, 10);
    if (!lastOdometer || !currentValue || isNaN(currentValue)) return null;

    const difference = currentValue - lastOdometer.value;
    const percentChange = (difference / lastOdometer.value) * 100;

    // Anomaly detection rules for odometer:
    // - Odometer should never go backwards (unless reset)
    // - Large jumps (>5000 km) might indicate a reading error
    // - Very large jumps (>10000 km) are very suspicious

    if (difference < 0) {
      // Odometer went backwards
      return {
        type: 'odometer',
        currentValue,
        lastValue: lastOdometer.value,
        difference,
        percentChange,
        warning: `Odometer decreased by ${Math.abs(difference).toLocaleString()} km. Previous reading: ${lastOdometer.value.toLocaleString()} km.`,
        severity: 'high',
      };
    }

    if (difference > 10000) {
      return {
        type: 'odometer',
        currentValue,
        lastValue: lastOdometer.value,
        difference,
        percentChange,
        warning: `Large increase of ${difference.toLocaleString()} km since last reading (${lastOdometer.value.toLocaleString()} km). Please verify this is correct.`,
        severity: 'high',
      };
    }

    if (difference > 5000) {
      return {
        type: 'odometer',
        currentValue,
        lastValue: lastOdometer.value,
        difference,
        percentChange,
        warning: `Increase of ${difference.toLocaleString()} km since last reading (${lastOdometer.value.toLocaleString()} km). Please verify.`,
        severity: 'medium',
      };
    }

    return null;
  }, [formState.odometerReading, lastOdometer]);

  // Anomaly detection for fuel level
  const fuelAnomaly = useMemo((): ReadingAnomaly | null => {
    const currentValue = parseInt(formState.fuelLevel, 10);
    if (!lastFuel || !currentValue || isNaN(currentValue)) return null;

    const difference = currentValue - lastFuel.value;
    const percentChange = Math.abs(difference);

    // Anomaly detection rules for fuel:
    // - Large increases (>50%) might indicate a fill-up (normal)
    // - Large decreases (>50%) might indicate an error or heavy usage
    // - Values outside 0-100 range are invalid

    if (currentValue < 0 || currentValue > 100) {
      return {
        type: 'fuel',
        currentValue,
        lastValue: lastFuel.value,
        difference,
        percentChange,
        warning: `Fuel level must be between 0% and 100%.`,
        severity: 'high',
      };
    }

    if (difference < -50) {
      return {
        type: 'fuel',
        currentValue,
        lastValue: lastFuel.value,
        difference,
        percentChange,
        warning: `Large fuel drop from ${lastFuel.value}% to ${currentValue}% (${Math.abs(difference)}% decrease). Please verify.`,
        severity: 'medium',
      };
    }

    return null;
  }, [formState.fuelLevel, lastFuel]);

  // Add anomaly validation errors (computed after anomaly detection)
  const anomalyValidationErrors = useMemo(() => {
    const errors: string[] = [];
    if (odometerAnomaly && !odometerOverrideConfirmed && odometerAnomaly.severity === 'high') {
      errors.push(`Odometer anomaly: ${odometerAnomaly.warning} Please confirm or correct.`);
    }
    if (fuelAnomaly && !fuelOverrideConfirmed && fuelAnomaly.severity === 'high') {
      errors.push(`Fuel anomaly: ${fuelAnomaly.warning} Please confirm or correct.`);
    }
    return errors;
  }, [odometerAnomaly, fuelAnomaly, odometerOverrideConfirmed, fuelOverrideConfirmed]);

  // Final canSubmit check including anomaly errors
  const finalCanSubmit = validationErrors.length === 0 && anomalyValidationErrors.length === 0;
  const allValidationErrors = [...validationErrors, ...anomalyValidationErrors];

  // Override confirmation handlers
  const confirmOdometerOverride = useCallback(() => {
    setOdometerOverrideConfirmed(true);
  }, []);

  const confirmFuelOverride = useCallback(() => {
    setFuelOverrideConfirmed(true);
  }, []);

  return {
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

    // Manual override tracking
    odometerOverrideConfirmed,
    fuelOverrideConfirmed,

    setCheckType,
    setOdometerReading,
    setFuelLevel,
    setItemResponse,
    setPhoto,
    removePhoto,
    overrideVlmValue,
    confirmOdometerOverride,
    confirmFuelOverride,
    loadTemplate,
    processPhotoWithVlm,
    submit,
    reset,
    canSubmit: finalCanSubmit,
    validationErrors: allValidationErrors,
    hasCriticalFailures,
    hasMinorFailures,
    requiredPhotos,
  };
}
