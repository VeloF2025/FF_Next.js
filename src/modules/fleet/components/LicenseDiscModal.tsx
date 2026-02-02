'use client';

/**
 * License Disc Modal
 *
 * Two-step wizard for adding/renewing vehicle license disc records:
 * 1. Upload photo of license disc (mandatory)
 * 2. VLM extracts ALL data, user verifies against vehicle record, then saves
 *
 * Features:
 * - Full OCR extraction (disc number, registration, VIN, engine number, etc.)
 * - Cross-verification against vehicle record
 * - Mismatch warnings with visual indicators
 * - Option to update vehicle record with extracted data
 */

import { useState, useCallback } from 'react';
import {
  X,
  Loader2,
  Upload,
  Calendar,
  Car,
  DollarSign,
  Camera,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Edit3,
  RefreshCw,
  Info,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type { LicenseDisc, CreateLicenseDiscRequest } from '@/modules/fleet/types';
import type { LicenseDiskExtractionResult } from '@/modules/fleet/types/check-in.types';

// Vehicle data needed for verification - compatible with both page and module types
interface VehicleForVerification {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  engineNumber: string | null;
}

// South African provinces for license disc
const SA_PROVINCES = [
  { value: 'GP', label: 'Gauteng' },
  { value: 'WC', label: 'Western Cape' },
  { value: 'KZN', label: 'KwaZulu-Natal' },
  { value: 'EC', label: 'Eastern Cape' },
  { value: 'FS', label: 'Free State' },
  { value: 'MP', label: 'Mpumalanga' },
  { value: 'NW', label: 'North West' },
  { value: 'LP', label: 'Limpopo' },
  { value: 'NC', label: 'Northern Cape' },
];

interface LicenseDiscModalProps {
  vehicleId: string;
  vehicleRegistration: string;
  vehicle: VehicleForVerification; // Vehicle data for verification
  currentDisc: LicenseDisc | null;
  onSuccess: (vehicleUpdates?: Partial<VehicleForVerification>) => void;
  onClose: () => void;
}

type Step = 'upload' | 'confirm';

interface VerificationResult {
  field: string;
  label: string;
  extracted: string | number | null;
  expected: string | number | null;
  matches: boolean | null; // null if can't compare (one side missing)
  canUpdate: boolean; // Can we update the vehicle record with this?
}

export function LicenseDiscModal({
  vehicleId,
  vehicleRegistration,
  vehicle,
  currentDisc,
  onSuccess,
  onClose,
}: LicenseDiscModalProps) {
  const isRenewal = !!currentDisc;

  // Wizard state
  const [step, setStep] = useState<Step>('upload');

  // Upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<LicenseDiskExtractionResult | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  // Form state (populated from extraction, editable by user)
  const [licenseNumber, setLicenseNumber] = useState('');
  const [province, setProvince] = useState('GP');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cost, setCost] = useState('');
  const [arrears, setArrears] = useState('');
  const [penalties, setPenalties] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [reminderDays, setReminderDays] = useState('30');

  // Vehicle update selections (user can choose which fields to update)
  const [updateVin, setUpdateVin] = useState(false);
  const [updateEngineNumber, setUpdateEngineNumber] = useState(false);
  const [updateColor, setUpdateColor] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Handle image selection
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setExtractionError('Please select an image file');
      return;
    }

    // Validate file size (max 10MB for VLM)
    if (file.size > 10 * 1024 * 1024) {
      setExtractionError('Image must be smaller than 10MB');
      return;
    }

    setImageFile(file);
    setExtractionError(null);
    setExtractionResult(null);

    // Create preview and base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImagePreview(dataUrl);
      // Extract base64 portion (remove data:image/xxx;base64, prefix)
      const base64 = dataUrl.split(',')[1] || dataUrl;
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  // Extract data from uploaded image using VLM
  const handleExtract = useCallback(async () => {
    if (!imageBase64) {
      setExtractionError('Please upload an image first');
      return;
    }

    setExtracting(true);
    setExtractionError(null);

    try {
      const res = await fetch('/api/fleet/vehicles/extract-license-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      });

      if (!res.ok) {
        throw new Error('Failed to extract data from image');
      }

      const data = await res.json();
      const result: LicenseDiskExtractionResult = data.data;

      if (result.error) {
        setExtractionError(`Extraction error: ${result.error}`);
        return;
      }

      if (result.confidence < 0.3) {
        setExtractionError('Could not read the license disc clearly. Please try with a clearer photo.');
        return;
      }

      setExtractionResult(result);

      // Populate form fields from extraction
      if (result.discNumber) {
        setLicenseNumber(result.discNumber);
      }

      if (result.licenseExpiry) {
        setExpiryDate(result.licenseExpiry);
      }

      // Try to extract province from registration
      if (result.registration) {
        const regMatch = result.registration.match(/\b(GP|WC|KZN|EC|FS|MP|NW|LP|NC)\b/i);
        if (regMatch && regMatch[1]) {
          setProvince(regMatch[1].toUpperCase());
        }
      }

      // Auto-select updates for missing vehicle data
      if (!vehicle.vin && result.vin) {
        setUpdateVin(true);
      }
      if (!vehicle.engineNumber && result.engineNumber) {
        setUpdateEngineNumber(true);
      }
      if (!vehicle.color && result.color) {
        setUpdateColor(true);
      }

      // Move to confirm step
      setStep('confirm');

      log.info('License disc extraction successful', {
        vehicleId,
        confidence: result.confidence,
        expiry: result.licenseExpiry,
        hasVin: !!result.vin,
        hasEngineNumber: !!result.engineNumber,
      });
    } catch (error) {
      log.error('License disc extraction failed', { error });
      setExtractionError(error instanceof Error ? error.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }, [imageBase64, vehicleId, vehicle.vin, vehicle.engineNumber, vehicle.color]);

  // Upload image to storage
  const uploadImage = useCallback(async (file: File): Promise<string> => {
    // Create custom filename with vehicleId prefix for organization
    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'jpg';
    const customFilename = `${vehicleId}_${timestamp}.${ext}`;

    const formData = new FormData();
    // Pass custom filename as third argument to append
    formData.append('file', file, customFilename);
    formData.append('type', 'fleet');
    // Use flat category path - avoid nested slashes
    formData.append('category', 'license-discs');

    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to upload image');
    }

    const data = await res.json();
    return data.url;
  }, [vehicleId]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    // Validate required field
    if (!expiryDate) {
      setSubmitError('Expiry date is required');
      return;
    }

    if (!imageFile) {
      setSubmitError('License disc photo is required');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Upload image first
      const documentUrl = await uploadImage(imageFile);

      // Build request body for license disc
      const body: CreateLicenseDiscRequest = {
        expiryDate,
        licenseNumber: licenseNumber || undefined,
        province: province || undefined,
        issueDate: issueDate || undefined,
        cost: cost ? parseFloat(cost) : undefined,
        arrears: arrears ? parseFloat(arrears) : undefined,
        penalties: penalties ? parseFloat(penalties) : undefined,
        totalPaid: totalPaid ? parseFloat(totalPaid) : undefined,
        documentUrl,
        renewalReminderDays: parseInt(reminderDays) || 30,
      };

      // Submit license disc to API
      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/license-disc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save license disc');
      }

      // Build vehicle updates if any selected
      const vehicleUpdates: Partial<VehicleForVerification> = {};
      if (updateVin && extractionResult?.vin) {
        vehicleUpdates.vin = extractionResult.vin;
      }
      if (updateEngineNumber && extractionResult?.engineNumber) {
        vehicleUpdates.engineNumber = extractionResult.engineNumber;
      }
      if (updateColor && extractionResult?.color) {
        vehicleUpdates.color = extractionResult.color;
      }

      // Update vehicle if any fields selected
      if (Object.keys(vehicleUpdates).length > 0) {
        const vehicleRes = await fetch(`/api/fleet/vehicles/${vehicleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vehicleUpdates),
        });

        if (!vehicleRes.ok) {
          log.warn('Failed to update vehicle with extracted data', { vehicleId });
        } else {
          log.info('Vehicle updated with extracted data', { vehicleId, updates: Object.keys(vehicleUpdates) });
        }
      }

      log.info('License disc saved successfully', { vehicleId, isRenewal });
      onSuccess(Object.keys(vehicleUpdates).length > 0 ? vehicleUpdates : undefined);
      onClose();
    } catch (err) {
      log.error('Failed to save license disc', { error: err });
      setSubmitError(err instanceof Error ? err.message : 'Failed to save license disc');
    } finally {
      setSubmitting(false);
    }
  }, [
    expiryDate, licenseNumber, province, issueDate, cost, arrears, penalties,
    totalPaid, reminderDays, imageFile, vehicleId, isRenewal, uploadImage,
    onSuccess, onClose, updateVin, updateEngineNumber, updateColor, extractionResult,
  ]);

  // Go back to upload step
  const handleBack = useCallback(() => {
    setStep('upload');
    setExtractionResult(null);
  }, []);

  // Build verification results
  const getVerificationResults = useCallback((): VerificationResult[] => {
    if (!extractionResult) return [];

    const normalize = (val: string | null | undefined) =>
      val?.replace(/[\s-]/g, '').toUpperCase() || null;

    const results: VerificationResult[] = [];

    // Registration
    const extractedReg = normalize(extractionResult.registration);
    const expectedReg = normalize(vehicleRegistration);
    results.push({
      field: 'registration',
      label: 'Registration',
      extracted: extractionResult.registration,
      expected: vehicleRegistration,
      matches: extractedReg && expectedReg ? extractedReg.includes(expectedReg) || expectedReg.includes(extractedReg) : null,
      canUpdate: false, // Don't update registration from disc
    });

    // VIN
    results.push({
      field: 'vin',
      label: 'VIN',
      extracted: extractionResult.vin,
      expected: vehicle.vin,
      matches: extractionResult.vin && vehicle.vin
        ? normalize(extractionResult.vin) === normalize(vehicle.vin)
        : null,
      canUpdate: !vehicle.vin && !!extractionResult.vin,
    });

    // Engine Number
    results.push({
      field: 'engineNumber',
      label: 'Engine Number',
      extracted: extractionResult.engineNumber,
      expected: vehicle.engineNumber,
      matches: extractionResult.engineNumber && vehicle.engineNumber
        ? normalize(extractionResult.engineNumber) === normalize(vehicle.engineNumber)
        : null,
      canUpdate: !vehicle.engineNumber && !!extractionResult.engineNumber,
    });

    // Make
    results.push({
      field: 'make',
      label: 'Make',
      extracted: extractionResult.make,
      expected: vehicle.make,
      matches: extractionResult.make && vehicle.make
        ? extractionResult.make.toUpperCase() === vehicle.make.toUpperCase()
        : null,
      canUpdate: false,
    });

    // Model/Description
    results.push({
      field: 'description',
      label: 'Model/Description',
      extracted: extractionResult.description,
      expected: vehicle.model,
      matches: null, // Description vs model is not a direct match
      canUpdate: false,
    });

    // Year
    results.push({
      field: 'year',
      label: 'Year',
      extracted: extractionResult.year,
      expected: vehicle.year,
      matches: extractionResult.year && vehicle.year
        ? extractionResult.year === vehicle.year
        : null,
      canUpdate: false,
    });

    // Color
    results.push({
      field: 'color',
      label: 'Color',
      extracted: extractionResult.color,
      expected: vehicle.color,
      matches: extractionResult.color && vehicle.color
        ? extractionResult.color.toUpperCase() === vehicle.color.toUpperCase()
        : null,
      canUpdate: !vehicle.color && !!extractionResult.color,
    });

    return results;
  }, [extractionResult, vehicleRegistration, vehicle]);

  const verificationResults = getVerificationResults();
  const hasMismatches = verificationResults.some(r => r.matches === false);
  const hasNewData = verificationResults.some(r => r.canUpdate);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--ff-primary)]/10 rounded-lg">
              <Car className="w-5 h-5 text-[var(--ff-primary)]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {isRenewal ? 'Renew License Disc' : 'Add License Disc'}
              </h3>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {vehicleRegistration} • {vehicle.make} {vehicle.model} {vehicle.year}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-4 py-3 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] flex items-center gap-4">
          <div className={`flex items-center gap-2 ${step === 'upload' ? 'text-[var(--ff-primary)]' : 'text-[var(--ff-text-tertiary)]'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              step === 'upload' ? 'bg-[var(--ff-primary)] text-white' : 'bg-[var(--ff-bg-tertiary)]'
            }`}>
              1
            </div>
            <span className="text-sm font-medium">Upload Photo</span>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <div className={`flex items-center gap-2 ${step === 'confirm' ? 'text-[var(--ff-primary)]' : 'text-[var(--ff-text-tertiary)]'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              step === 'confirm' ? 'bg-[var(--ff-primary)] text-white' : 'bg-[var(--ff-bg-tertiary)]'
            }`}>
              2
            </div>
            <span className="text-sm font-medium">Verify & Save</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' ? (
            // Step 1: Upload Photo
            <div className="space-y-4">
              {extractionError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{extractionError}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  License Disc Photo <span className="text-red-500">*</span>
                </label>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
                  Take a clear photo of the license disc. We&apos;ll extract all details including VIN, engine number, expiry date, and verify against the vehicle record.
                </p>

                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="License disc preview"
                      className="w-full h-64 object-contain rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                        setImageBase64(null);
                        setExtractionResult(null);
                      }}
                      className="absolute top-2 right-2 p-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                    >
                      <X className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-[var(--ff-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                    <div className="flex flex-col items-center justify-center py-4">
                      <Camera className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" />
                      <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                        Click to upload license disc photo
                      </p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        PNG, JPG up to 10MB
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          ) : (
            // Step 2: Verify & Save
            <div className="space-y-4">
              {submitError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Extraction Summary */}
              {extractionResult && (
                <div className={`p-3 rounded-lg border ${
                  hasMismatches
                    ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-green-500/10 border-green-500/20'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    {hasMismatches ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    <span className={`text-sm font-medium ${
                      hasMismatches ? 'text-amber-600' : 'text-green-600'
                    }`}>
                      {hasMismatches
                        ? 'Verification found mismatches - please review'
                        : 'Data extracted and verified successfully'}
                    </span>
                    <span className="text-xs text-[var(--ff-text-tertiary)] ml-auto">
                      {Math.round(extractionResult.confidence * 100)}% confidence
                    </span>
                  </div>
                </div>
              )}

              {/* Verification Table */}
              <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
                <div className="bg-[var(--ff-bg-secondary)] px-4 py-2 border-b border-[var(--ff-border-light)]">
                  <h4 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Vehicle Verification
                  </h4>
                </div>
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {verificationResults.map((result) => (
                    <div key={result.field} className="px-4 py-2.5 flex items-center gap-4">
                      <div className="w-28 text-sm text-[var(--ff-text-secondary)] shrink-0">
                        {result.label}
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-xs text-[var(--ff-text-tertiary)] block mb-0.5">Extracted</span>
                          <span className={`font-mono ${result.extracted ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)] italic'}`}>
                            {result.extracted || 'Not found'}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--ff-text-tertiary)] block mb-0.5">Vehicle Record</span>
                          <span className={`font-mono ${result.expected ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)] italic'}`}>
                            {result.expected || 'Not set'}
                          </span>
                        </div>
                      </div>
                      <div className="w-8 flex justify-center">
                        {result.matches === true && (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        )}
                        {result.matches === false && (
                          <AlertTriangle className="w-5 h-5 text-amber-500" />
                        )}
                        {result.matches === null && result.extracted && !result.expected && (
                          <Info className="w-5 h-5 text-blue-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Update Vehicle Options */}
              {hasNewData && (
                <div className="border border-blue-500/20 bg-blue-500/5 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-blue-500" />
                    Update Vehicle Record
                  </h4>
                  <p className="text-xs text-[var(--ff-text-secondary)] mb-3">
                    The following fields are missing from the vehicle record. Select which to update:
                  </p>
                  <div className="space-y-2">
                    {!vehicle.vin && extractionResult?.vin && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={updateVin}
                          onChange={(e) => setUpdateVin(e.target.checked)}
                          className="rounded border-[var(--ff-border-light)] text-[var(--ff-primary)] focus:ring-[var(--ff-primary)]"
                        />
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          VIN: <span className="font-mono text-xs">{extractionResult.vin}</span>
                        </span>
                      </label>
                    )}
                    {!vehicle.engineNumber && extractionResult?.engineNumber && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={updateEngineNumber}
                          onChange={(e) => setUpdateEngineNumber(e.target.checked)}
                          className="rounded border-[var(--ff-border-light)] text-[var(--ff-primary)] focus:ring-[var(--ff-primary)]"
                        />
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          Engine Number: <span className="font-mono text-xs">{extractionResult.engineNumber}</span>
                        </span>
                      </label>
                    )}
                    {!vehicle.color && extractionResult?.color && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={updateColor}
                          onChange={(e) => setUpdateColor(e.target.checked)}
                          className="rounded border-[var(--ff-border-light)] text-[var(--ff-primary)] focus:ring-[var(--ff-primary)]"
                        />
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          Color: <span className="font-mono text-xs">{extractionResult.color}</span>
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Additional Disc Data */}
              {extractionResult && (extractionResult.tare || extractionResult.gvm) && (
                <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
                  <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">
                    Additional Disc Data
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {extractionResult.tare && (
                      <div>
                        <span className="text-[var(--ff-text-tertiary)]">Tare (unladen mass):</span>
                        <span className="ml-2 font-medium">{extractionResult.tare} kg</span>
                      </div>
                    )}
                    {extractionResult.gvm && (
                      <div>
                        <span className="text-[var(--ff-text-tertiary)]">GVM (gross mass):</span>
                        <span className="ml-2 font-medium">{extractionResult.gvm} kg</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Editable License Disc Fields */}
              <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-4">
                  <Edit3 className="w-4 h-4" />
                  License Disc Details
                </div>

                {/* License Number & Province */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Disc Number
                    </label>
                    <input
                      type="text"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      placeholder="e.g. 4046048YMKK1"
                      className={`w-full px-3 py-2 border rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)] ${
                        licenseNumber
                          ? 'bg-green-500/5 border-green-500/30'
                          : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Province
                    </label>
                    <select
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                    >
                      {SA_PROVINCES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Issue Date & Expiry Date */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Issue Date
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="date"
                        value={issueDate}
                        onChange={(e) => setIssueDate(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Expiry Date <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        required
                        className={`w-full pl-10 pr-3 py-2 border rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)] ${
                          expiryDate
                            ? 'bg-green-500/5 border-green-500/30'
                            : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Cost Fields */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      License Cost (R)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Arrears (R)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={arrears}
                        onChange={(e) => setArrears(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Penalties (R)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={penalties}
                        onChange={(e) => setPenalties(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Total Paid (R)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={totalPaid}
                        onChange={(e) => setTotalPaid(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                      />
                    </div>
                  </div>
                </div>

                {/* Reminder Days */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Reminder Before Expiry
                  </label>
                  <select
                    value={reminderDays}
                    onChange={(e) => setReminderDays(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                  >
                    <option value="14">14 days before</option>
                    <option value="30">30 days before</option>
                    <option value="45">45 days before</option>
                    <option value="60">60 days before</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--ff-border-light)] flex items-center justify-between shrink-0">
          {step === 'upload' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={extracting}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || !imageFile}
                className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {extracting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    Extract & Verify
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)] disabled:opacity-50 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !expiryDate}
                className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {isRenewal ? 'Save Renewal' : 'Add License Disc'}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
