'use client';

/**
 * License Disc Modal
 *
 * Two-step wizard for adding/renewing vehicle license disc records:
 * 1. Upload photo of license disc (mandatory)
 * 2. VLM extracts data, user confirms/edits, then saves
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
  ArrowRight,
  ArrowLeft,
  Edit3,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type { LicenseDisc, CreateLicenseDiscRequest } from '@/modules/fleet/types';
import type { LicenseDiskExtractionResult } from '@/modules/fleet/types/check-in.types';

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
  currentDisc: LicenseDisc | null;
  onSuccess: () => void;
  onClose: () => void;
}

type Step = 'upload' | 'confirm';

export function LicenseDiscModal({
  vehicleId,
  vehicleRegistration,
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

      // Move to confirm step
      setStep('confirm');

      log.info('License disc extraction successful', {
        vehicleId,
        confidence: result.confidence,
        expiry: result.licenseExpiry,
      });
    } catch (error) {
      log.error('License disc extraction failed', { error });
      setExtractionError(error instanceof Error ? error.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }, [imageBase64, vehicleId]);

  // Upload image to storage
  const uploadImage = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'fleet');
    formData.append('category', `vehicles/${vehicleId}/license-disc`);

    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error('Failed to upload image');
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

      // Build request body
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

      // Submit to API
      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/license-disc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save license disc');
      }

      log.info('License disc saved successfully', { vehicleId, isRenewal });
      onSuccess();
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
    onSuccess, onClose,
  ]);

  // Go back to upload step
  const handleBack = useCallback(() => {
    setStep('upload');
    setExtractionResult(null);
  }, []);

  // Verify registration matches
  const registrationMatches = extractionResult?.registration
    ? extractionResult.registration.replace(/[\s-]/g, '').toUpperCase().includes(
        vehicleRegistration.replace(/[\s-]/g, '').toUpperCase()
      ) || vehicleRegistration.replace(/[\s-]/g, '').toUpperCase().includes(
        extractionResult.registration.replace(/[\s-]/g, '').toUpperCase()
      )
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
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
                {vehicleRegistration}
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
            <span className="text-sm font-medium">Confirm Details</span>
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
                  Take a clear photo of the license disc. We&apos;ll extract the expiry date and other details automatically.
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
            // Step 2: Confirm Details
            <div className="space-y-4">
              {submitError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Extraction Result Summary */}
              {extractionResult && (
                <div className={`p-3 rounded-lg border ${
                  extractionResult.confidence >= 0.7
                    ? 'bg-green-500/10 border-green-500/20'
                    : 'bg-amber-500/10 border-amber-500/20'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {extractionResult.confidence >= 0.7 ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    )}
                    <span className={`text-sm font-medium ${
                      extractionResult.confidence >= 0.7 ? 'text-green-600' : 'text-amber-600'
                    }`}>
                      {extractionResult.confidence >= 0.7
                        ? 'Data extracted successfully'
                        : 'Please verify extracted data'}
                    </span>
                    <span className="text-xs text-[var(--ff-text-tertiary)] ml-auto">
                      {Math.round(extractionResult.confidence * 100)}% confidence
                    </span>
                  </div>

                  {/* Registration verification */}
                  {extractionResult.registration && (
                    <div className={`text-sm ${
                      registrationMatches
                        ? 'text-green-600'
                        : 'text-amber-600'
                    }`}>
                      Extracted registration: <span className="font-mono font-medium">{extractionResult.registration}</span>
                      {registrationMatches ? ' ✓' : ' (verify match)'}
                    </div>
                  )}
                </div>
              )}

              {/* Editable Form */}
              <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-2">
                <Edit3 className="w-4 h-4" />
                Review and edit the extracted details below
              </div>

              {/* License Number & Province */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    License Number
                  </label>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="e.g. GP12345678"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
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
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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

              <div className="grid grid-cols-2 gap-4">
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
                    Extract Data
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
