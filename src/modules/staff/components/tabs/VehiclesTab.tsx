'use client';

import { useState, useEffect } from 'react';
import { Car, Plus, AlertTriangle, Calendar, Fuel, Gauge, FileWarning, Edit, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { VehicleAssignment } from '@/types/staff';
import { checkVehicleNeedsAttention, formatVehicleDisplayName } from '@/types/staff/vehicle.types';

interface VehiclesTabProps {
  staffId: string;
  staffName: string;
  onAddVehicle?: () => void;
  onEditVehicle?: (vehicle: VehicleAssignment) => void;
  onRemoveVehicle?: (vehicleId: string) => void;
}

export function VehiclesTab({
  staffId,
  staffName,
  onAddVehicle,
  onEditVehicle,
  onRemoveVehicle,
}: VehiclesTabProps) {
  const [vehicles, setVehicles] = useState<VehicleAssignment[]>([]);
  const [hasValidLicense, setHasValidLicense] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/staff/${staffId}/vehicles`);
        if (!response.ok) throw new Error('Failed to fetch vehicles');
        const data = await response.json();
        setVehicles(data.vehicles || []);
        setHasValidLicense(data.hasValidLicense || false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vehicles');
      } finally {
        setLoading(false);
      }
    };

    if (staffId) {
      fetchVehicles();
    }
  }, [staffId]);

  const activeVehicles = vehicles.filter((v) => v.isActive);
  const inactiveVehicles = vehicles.filter((v) => !v.isActive);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* License Warning */}
      {!hasValidLicense && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <FileWarning className="w-5 h-5 text-yellow-400 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-400">No Valid Driver&apos;s License</p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {staffName} does not have a verified, non-expired driver&apos;s license on file.
                A valid license is required before assigning a company vehicle.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add Vehicle Button */}
      {onAddVehicle && (
        <div className="flex justify-end">
          <button
            onClick={onAddVehicle}
            disabled={!hasValidLicense}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Assign Vehicle
          </button>
        </div>
      )}

      {/* Active Vehicles */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
          Active Vehicle Assignment
        </h2>

        {activeVehicles.length === 0 ? (
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-8 text-center">
            <Car className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-3" />
            <p className="text-[var(--ff-text-secondary)]">No vehicle currently assigned</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeVehicles.map((vehicle) => {
              const attention = checkVehicleNeedsAttention(vehicle);
              return (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  attention={attention}
                  onEdit={onEditVehicle}
                  onRemove={onRemoveVehicle}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Vehicle History */}
      {inactiveVehicles.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
            Vehicle History
          </h2>
          <div className="space-y-3">
            {inactiveVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 opacity-60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Car className="w-5 h-5 text-[var(--ff-text-muted)]" />
                    <div>
                      <p className="font-medium text-[var(--ff-text-primary)]">
                        {formatVehicleDisplayName(vehicle)}
                      </p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        {format(new Date(vehicle.assignmentStart), 'dd MMM yyyy')}
                        {vehicle.assignmentEnd && ` - ${format(new Date(vehicle.assignmentEnd), 'dd MMM yyyy')}`}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">
                    Ended
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface VehicleCardProps {
  vehicle: VehicleAssignment;
  attention: { needsAttention: boolean; reasons: string[] };
  onEdit?: (vehicle: VehicleAssignment) => void;
  onRemove?: (vehicleId: string) => void;
}

function VehicleCard({ vehicle, attention, onEdit, onRemove }: VehicleCardProps) {
  return (
    <div className={`bg-[var(--ff-bg-tertiary)] rounded-lg p-4 border ${
      attention.needsAttention ? 'border-yellow-500/50' : 'border-transparent'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Car className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-lg font-medium text-[var(--ff-text-primary)]">
              {formatVehicleDisplayName(vehicle)}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Assigned {format(new Date(vehicle.assignmentStart), 'dd MMM yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              onClick={() => onEdit(vehicle)}
              className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(vehicle.id)}
              className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Attention Banner */}
      {attention.needsAttention && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Attention Required</span>
          </div>
          <ul className="text-sm text-[var(--ff-text-secondary)] mt-1 list-disc list-inside">
            {attention.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {vehicle.licenseDiscExpiry && (
          <div>
            <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] mb-1">
              <Calendar className="w-3 h-3" />
              License Disc
            </div>
            <p className={`text-sm font-medium ${
              new Date(vehicle.licenseDiscExpiry) < new Date()
                ? 'text-red-400'
                : 'text-[var(--ff-text-primary)]'
            }`}>
              {format(new Date(vehicle.licenseDiscExpiry), 'dd MMM yyyy')}
            </p>
          </div>
        )}

        {vehicle.serviceDueDate && (
          <div>
            <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] mb-1">
              <Calendar className="w-3 h-3" />
              Service Due
            </div>
            <p className={`text-sm font-medium ${
              new Date(vehicle.serviceDueDate) < new Date()
                ? 'text-red-400'
                : 'text-[var(--ff-text-primary)]'
            }`}>
              {format(new Date(vehicle.serviceDueDate), 'dd MMM yyyy')}
            </p>
          </div>
        )}

        {vehicle.odometerCurrent && (
          <div>
            <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] mb-1">
              <Gauge className="w-3 h-3" />
              Odometer
            </div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {vehicle.odometerCurrent.toLocaleString()} km
            </p>
          </div>
        )}

        {vehicle.fuelCardNumber && (
          <div>
            <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] mb-1">
              <Fuel className="w-3 h-3" />
              Fuel Card
            </div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)] font-mono">
              ****{vehicle.fuelCardNumber.slice(-4)}
            </p>
            {vehicle.fuelCardLimit && (
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Limit: R{vehicle.fuelCardLimit.toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Additional Info */}
      {(vehicle.vehicleVin || vehicle.insurancePolicyNumber) && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)] grid grid-cols-2 gap-4 text-sm">
          {vehicle.vehicleVin && (
            <div>
              <p className="text-[var(--ff-text-secondary)]">VIN</p>
              <p className="font-mono text-[var(--ff-text-primary)]">{vehicle.vehicleVin}</p>
            </div>
          )}
          {vehicle.insurancePolicyNumber && (
            <div>
              <p className="text-[var(--ff-text-secondary)]">Insurance Policy</p>
              <p className="font-mono text-[var(--ff-text-primary)]">{vehicle.insurancePolicyNumber}</p>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {vehicle.notes && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
          <p className="text-sm text-[var(--ff-text-secondary)]">Notes</p>
          <p className="text-sm text-[var(--ff-text-primary)] mt-1">{vehicle.notes}</p>
        </div>
      )}
    </div>
  );
}
