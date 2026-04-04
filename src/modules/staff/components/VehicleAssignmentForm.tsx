'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, Car, Fuel, AlertTriangle, Search } from 'lucide-react';
import { formatDateISO } from '@/utils/dateFormat';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { VehicleAssignment, VehicleAssignmentCreate } from '@/types/staff';
import { COMMON_VEHICLE_MAKES } from '@/types/staff/vehicle.types';
import Link from 'next/link';
import { log } from '@/lib/logger';

interface FleetVehicleOption {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  status: string;
  hasDriver: boolean;
  driverName: string | null;
}

interface VehicleAssignmentFormProps {
  staffId: string;
  staffName: string;
  hasValidLicense: boolean;
  vehicle?: VehicleAssignment | null;
  onSave: (vehicle: Partial<VehicleAssignment> & { fleetVehicleId?: string }) => Promise<void>;
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
  // Vehicle source: 'fleet' to select from existing, 'manual' to enter details
  const [vehicleSource, setVehicleSource] = useState<'fleet' | 'manual'>(vehicle ? 'manual' : 'fleet');
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicleOption[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [selectedFleetVehicleId, setSelectedFleetVehicleId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    vehicleRegistration: vehicle?.vehicleRegistration || '',
    vehicleMake: vehicle?.vehicleMake || '',
    vehicleModel: vehicle?.vehicleModel || '',
    vehicleYear: vehicle?.vehicleYear?.toString() || '',
    vehicleColor: vehicle?.vehicleColor || '',
    vehicleVin: vehicle?.vehicleVin || '',
    assignmentStart: vehicle?.assignmentStart
      ? formatDateISO(vehicle.assignmentStart)
      : formatDateISO(new Date()),
    assignmentEnd: vehicle?.assignmentEnd
      ? formatDateISO(vehicle.assignmentEnd)
      : '',
    fuelCardNumber: vehicle?.fuelCardNumber || '',
    fuelCardLimit: vehicle?.fuelCardLimit?.toString() || '',
    odometerStart: vehicle?.odometerStart?.toString() || '',
    odometerCurrent: vehicle?.odometerCurrent?.toString() || '',
    licenseDiscExpiry: vehicle?.licenseDiscExpiry
      ? formatDateISO(vehicle.licenseDiscExpiry)
      : '',
    serviceDueDate: vehicle?.serviceDueDate
      ? formatDateISO(vehicle.serviceDueDate)
      : '',
    serviceDueKm: vehicle?.serviceDueKm?.toString() || '',
    insurancePolicyNumber: vehicle?.insurancePolicyNumber || '',
    notes: vehicle?.notes || '',
    isActive: vehicle?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch fleet vehicles on mount
  useEffect(() => {
    const fetchFleetVehicles = async () => {
      setLoadingFleet(true);
      try {
        const res = await fetch('/api/fleet/vehicles?limit=100&status=active');
        if (res.ok) {
          const data = await res.json();
          const vehicles: FleetVehicleOption[] = (data.data || []).map((v: Record<string, unknown>) => ({
            id: v.id as string,
            registration: v.registration as string,
            make: v.make as string | null,
            model: v.model as string | null,
            year: v.year as number | null,
            color: v.color as string | null,
            vin: v.vin as string | null,
            status: v.status as string,
            hasDriver: !!v.assignedStaffId,
            driverName: v.assignedStaffName as string | null,
          }));
          setFleetVehicles(vehicles);
        }
      } catch (err) {
        log.error('Failed to fetch fleet vehicles', err, 'VehicleAssignmentForm');
      } finally {
        setLoadingFleet(false);
      }
    };

    if (!vehicle) {
      fetchFleetVehicles();
    }
  }, [vehicle]);

  // When a fleet vehicle is selected, populate form fields
  const handleFleetVehicleSelect = (vehicleId: string) => {
    setSelectedFleetVehicleId(vehicleId);
    const selected = fleetVehicles.find(v => v.id === vehicleId);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        vehicleRegistration: selected.registration,
        vehicleMake: selected.make || '',
        vehicleModel: selected.model || '',
        vehicleYear: selected.year?.toString() || '',
        vehicleColor: selected.color || '',
        vehicleVin: selected.vin || '',
      }));
    }
  };

  // Filter fleet vehicles by search query
  const filteredFleetVehicles = fleetVehicles.filter(v => {
    const query = searchQuery.toLowerCase();
    return (
      v.registration.toLowerCase().includes(query) ||
      (v.make?.toLowerCase().includes(query)) ||
      (v.model?.toLowerCase().includes(query))
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hasValidLicense) {
      setError('Cannot assign vehicle without a valid driver\'s license on file');
      return;
    }

    if (vehicleSource === 'fleet' && !selectedFleetVehicleId) {
      setError('Please select a vehicle from the fleet');
      return;
    }

    if (!formData.vehicleRegistration.trim()) {
      setError('Vehicle registration is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<VehicleAssignment> & { fleetVehicleId?: string } = {
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
        // Include fleet vehicle ID if selected
        ...(vehicleSource === 'fleet' && selectedFleetVehicleId && { fleetVehicleId: selectedFleetVehicleId }),
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

          {/* Vehicle Source Selection (only for new assignments) */}
          {!vehicle && (
            <div>
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                <Car className="w-4 h-4" />
                Select Vehicle
              </h3>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setVehicleSource('fleet');
                    setSelectedFleetVehicleId('');
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    vehicleSource === 'fleet'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                  }`}
                >
                  From Fleet
                </button>
                <button
                  type="button"
                  onClick={() => setVehicleSource('manual')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    vehicleSource === 'manual'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                  }`}
                >
                  Enter Manually
                </button>
              </div>

              {vehicleSource === 'fleet' && (
                <div className="space-y-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by registration, make, or model..."
                      className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Fleet vehicle list */}
                  {loadingFleet ? (
                    <div className="flex items-center justify-center py-6">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : filteredFleetVehicles.length === 0 ? (
                    <div className="text-center py-6 text-[var(--ff-text-secondary)]">
                      {searchQuery ? 'No matching vehicles found' : 'No fleet vehicles available'}
                      <Link href="/fleet/vehicles/new" className="block mt-2 text-blue-500 hover:underline">
                        Create new vehicle in Fleet
                      </Link>
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-2 border border-[var(--ff-border-light)] rounded-lg p-2">
                      {filteredFleetVehicles.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => handleFleetVehicleSelect(v.id)}
                          className={`w-full p-3 rounded-lg text-left transition-colors ${
                            selectedFleetVehicleId === v.id
                              ? 'bg-blue-600/20 border border-blue-500'
                              : 'bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] border border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-[var(--ff-text-primary)]">
                                {v.registration}
                              </p>
                              <p className="text-sm text-[var(--ff-text-secondary)]">
                                {v.make} {v.model} {v.year ? `(${v.year})` : ''}
                              </p>
                            </div>
                            {v.hasDriver && (
                              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                                Assigned to {v.driverName}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vehicle Details */}
          <div className={vehicleSource === 'fleet' && !vehicle ? 'opacity-50 pointer-events-none' : ''}>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <Car className="w-4 h-4" />
              Vehicle Details {vehicleSource === 'fleet' && !vehicle && '(auto-filled from selection)'}
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
                  readOnly={vehicleSource === 'fleet' && !vehicle}
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
