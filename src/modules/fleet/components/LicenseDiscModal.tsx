'use client';

/**
 * License Disc Modal
 *
 * Modal for adding/renewing vehicle license disc records.
 * Supports optional photo upload of the license disc to Firebase Storage.
 */

import { useState, useCallback } from 'react';
import { X, Loader2, Upload, Calendar, Car, DollarSign, Image as ImageIcon, Trash2 } from 'lucide-react';
import { log } from '@/lib/logger';
import type { LicenseDisc, CreateLicenseDiscRequest } from '@/modules/fleet/types';

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

export function LicenseDiscModal({
  vehicleId,
  vehicleRegistration,
  currentDisc,
  onSuccess,
  onClose,
}: LicenseDiscModalProps) {
  const isRenewal = !!currentDisc;

  // Form state
  const [licenseNumber, setLicenseNumber] = useState(currentDisc?.licenseNumber || '');
  const [province, setProvince] = useState(currentDisc?.province || 'GP');
  const [issueDate, setIssueDate] = useState(currentDisc?.issueDate?.split('T')[0] || '');
  const [expiryDate, setExpiryDate] = useState('');
  const [cost, setCost] = useState('');
  const [arrears, setArrears] = useState('');
  const [penalties, setPenalties] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [reminderDays, setReminderDays] = useState('30');

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle image selection
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5MB');
      return;
    }

    setImageFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // Remove selected image
  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
  }, []);

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
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required field
    if (!expiryDate) {
      setError('Expiry date is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let documentUrl: string | undefined;

      // Upload image if selected
      if (imageFile) {
        setUploadingImage(true);
        try {
          documentUrl = await uploadImage(imageFile);
        } catch (uploadError) {
          log.error('Failed to upload license disc image', { error: uploadError });
          setError('Failed to upload image. Please try again.');
          setSubmitting(false);
          setUploadingImage(false);
          return;
        }
        setUploadingImage(false);
      }

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
      setError(err instanceof Error ? err.message : 'Failed to save license disc');
    } finally {
      setSubmitting(false);
    }
  }, [
    expiryDate, licenseNumber, province, issueDate, cost, arrears, penalties,
    totalPaid, reminderDays, imageFile, vehicleId, isRenewal, uploadImage,
    onSuccess, onClose,
  ]);

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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
              {error}
            </div>
          )}

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
                  className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
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
              Reminder Before Expiry (days)
            </label>
            <select
              value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
            >
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="45">45 days</option>
              <option value="60">60 days</option>
            </select>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              License Disc Photo (Optional)
            </label>
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="License disc preview"
                  className="w-full h-48 object-cover rounded-lg border border-[var(--ff-border-light)]"
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-[var(--ff-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                <div className="flex flex-col items-center justify-center py-4">
                  <ImageIcon className="w-8 h-8 text-[var(--ff-text-tertiary)] mb-2" />
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Click to upload license disc photo
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                    PNG, JPG up to 5MB
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--ff-border-light)] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting || !expiryDate}
            className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploadingImage ? 'Uploading...' : 'Saving...'}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {isRenewal ? 'Save Renewal' : 'Add License Disc'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
