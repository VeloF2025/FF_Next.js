'use client';

import { useState } from 'react';
import { X, Calendar, Car, Fuel, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import type { VehicleAssignment } from '@/types/staff';
import { COMMON_VEHICLE_MAKES } from '@/types/staff/vehicle.types';

interface VehicleAssignmentFormProps {
  staffId: string;
  staffName: string;
  hasValidLicense: boolean;
  vehicle?: VehicleAssignment | null;
  onSave: (vehicle: Partial<VehicleAssignment>) => Promise<void>;
  onClose: () => void;
}

export function VehicleAssignmentForm({
  staffId,
  staffName,
  hasValidLicense,
  vehicle,
  onSave,
  onClose,
}: VehicleAssignmentFormProps) {
  const [formData, setFormData] = useState({
    vehicleRegistration: vehicle?.vehicleRegistration || '',
    vehicleMake: vehicle?.vehicleMake || '',
    vehicleModel: vehicle?.vehicleModel || '',
    vehicleYear: vehicle?.vehicleYear?.toString() || '',
    vehicleColor: vehicle?.vehicleColor || '',
    vehicleVin: vehicle?.vehicleVin || '',
    assignmentStart: vehicle?.assignmentStart
      ? format(new Date(vehicle.assignmentStart), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd'),
    assignmentEnd: vehicle?.assignmentEnd
      ? format(new Date(vehicle.assignmentEnd), 'yyyy-MM-dd')
      : '',
    fuelCardNumber: vehicle?.fuelCardNumber || '',
    fuelCardLimit: vehicle?.fuelCardLimit?.toString() || '',
    odometerStart: vehicle?.odometerStart?.toString() || '',
    odometerCurrent: vehicle?.odometerCurrent?.toString() || '',
    licenseDiscExpiry: vehicle?.licenseDiscExpiry
      ? format(new Date(vehicle.licenseDiscExpiry), 'yyyy-MM-dd')
      : '',
    serviceDueDate: vehicle?.serviceDueDate
      ? format(new Date(vehicle.serviceDueDate), 'yyyy-MM-dd')
      : '',
    serviceDueKm: vehicle?.serviceDueKm?.toString() || '',
    insurancePolicyNumber: vehicle?.insurancePolicyNumber || '',
    notes: vehicle?.notes || '',
    isActive: vehicle?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hasValidLicense) {
      setError('Cannot assign vehicle without a valid driver\'s license on file');
      return;
    }

    if (!formData.vehicleRegistration.trim()) {
      setError('Vehicle registration is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<VehicleAssignment> = {
        ...(vehicle?.id && { id: vehicle.id }),
        staffId,
        vehicleRegistration: formData.vehicleRegistration.trim().toUpperCase(),
        vehicleMake: formData.vehicleMake.trim() || undefined,
        vehicleModel: formData.vehicleModel.trim() || undefined,
        vehicleYear: formData.vehicleYear ? parseInt(formData.vehicleYear) : undefined,
        vehicleColor: formData.vehicleColor.trim() || undefined,
        vehicleVin: formData.vehicleVin.trim() || undefined,
        assignmentStart: formData.assignmentStart,
        assignmentEnd: formData.assignmentEnd || undefined,
        fuelCardNumber: formData.fuelCardNumber.trim() || undefined,
        fuelCardLimit: formData.fuelCardLimit ? parseFloat(formData.fuelCardLimit) : undefined,
        odometerStart: formData.odometerStart ? parseInt(formData.odometerStart) : undefined,
        odometerCurrent: formData.odometerCurrent ? parseInt(formData.odometerCurrent) : undefined,
        licenseDiscExpiry: formData.licenseDiscExpiry || undefined,
        serviceDueDate: formData.serviceDueDate || undefined,
        serviceDueKm: formData.serviceDueKm ? parseInt(formData.serviceDueKm) : undefined,
        insurancePolicyNumber: formData.insurancePolicyNumber.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        isActive: formData.isActive,
      };

      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save vehicle assignment');
    } finally {
      setSaving(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => currentYear - i);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              {vehicle ? 'Edit Vehicle Assignment' : 'Assign Vehicle'}
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Assigning to {staffName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* License Warning */}
        {!hasValidLicense && (
          <div className="mx-4 mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-400">Valid License Required</p>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                  {staffName} must have a verified, non-expired driver&apos;s license on file
                  before being assigned a company vehicle.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Vehicle Details */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Car className="w-4 h-4" />
              Vehicle Details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Registration *
                </label>
                <input
                  type="text"
                  value={formData.vehicleRegistration}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleRegistration: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  placeholder="CA 123-456"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Make
                </label>
                <select
                  value={formData.vehicleMake}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleMake: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select make</option>
                  {COMMON_VEHICLE_MAKES.map((make) => (
                    <option key={make} value={make}>
                      {make}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Model
                </label>
                <input
                  type="text"
                  value={formData.vehicleModel}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleModel: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Hilux, Ranger, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Year
                </label>
                <select
                  value={formData.vehicleYear}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleYear: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select year</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Color
                </label>
                <input
                  type="text"
                  value={formData.vehicleColor}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleColor: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="White, Silver, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  VIN
                </label>
                <input
                  type="text"
                  value={formData.vehicleVin}
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleVin: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="Vehicle Identification Number"
                />
              </div>
            </div>
          </div>

          {/* Assignment Period */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Assignment Period
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={formData.assignmentStart}
                  onChange={(e) => setFormData((prev) => ({ ...prev, assignmentStart: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={formData.assignmentEnd}
                  onChange={(e) => setFormData((prev) => ({ ...prev, assignmentEnd: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Fuel Card */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Fuel className="w-4 h-4" />
              Fuel Card
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Card Number
                </label>
                <input
                  type="text"
                  value={formData.fuelCardNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, fuelCardNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="Card number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Monthly Limit (R)
                </label>
                <input
                  type="number"
                  value={formData.fuelCardLimit}
                  onChange={(e) => setFormData((prev) => ({ ...prev, fuelCardLimit: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000"
                  min="0"
                />
              </div>
            </div>
          </div>

          {/* Odometer & Service */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">
              Odometer & Service
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Starting KM
                </label>
                <input
                  type="number"
                  value={formData.odometerStart}
                  onChange={(e) => setFormData((prev) => ({ ...prev, odometerStart: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Current KM
                </label>
                <input
                  type="number"
                  value={formData.odometerCurrent}
                  onChange={(e) => setFormData((prev) => ({ ...prev, odometerCurrent: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="55000"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Service Due Date
                </label>
                <input
                  type="date"
                  value={formData.serviceDueDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, serviceDueDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Service Due KM
                </label>
                <input
                  type="number"
                  value={formData.serviceDueKm}
                  onChange={(e) => setFormData((prev) => ({ ...prev, serviceDueKm: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="60000"
                  min="0"
                />
              </div>
            </div>
          </div>

          {/* License & Insurance */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">
              License & Insurance
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  License Disc Expiry
                </label>
                <input
                  type="date"
                  value={formData.licenseDiscExpiry}
                  onChange={(e) => setFormData((prev) => ({ ...prev, licenseDiscExpiry: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Insurance Policy Number
                </label>
                <input
                  type="text"
                  value={formData.insurancePolicyNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, insurancePolicyNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="Policy number"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Additional notes about this vehicle assignment..."
            />
          </div>

          {/* Active Status (for editing) */}
          {vehicle && (
            <div className="flex items-center gap-3 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-[var(--ff-text-primary)]">
                Assignment is Active
              </label>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !hasValidLicense}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : vehicle ? 'Update Assignment' : 'Assign Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
