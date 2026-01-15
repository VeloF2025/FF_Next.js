/**
 * Fleet Drivers List Tab
 * Table view of all drivers with filtering
 */

import { useState, useMemo } from 'react';
import {
  User,
  Car,
  Search,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';
import type { FleetDriver } from '@/modules/fleet/types/driver.types';
import {
  getLicenseStatusColor,
  getLicenseStatusLabel,
  getDriverStatusColor,
} from '@/modules/fleet/types/driver.types';

interface DriversListTabProps {
  drivers: FleetDriver[];
  onViewScorecard: (staffId: string) => void;
}

function LicenseStatusIcon({ status }: { status: FleetDriver['licenseStatus'] }) {
  switch (status) {
    case 'valid':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'expiring':
      return <Clock className="w-4 h-4 text-yellow-500" />;
    case 'expired':
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
}

function DriverRow({
  driver,
  onViewScorecard,
}: {
  driver: FleetDriver;
  onViewScorecard: () => void;
}) {
  const isActive = driver.status === 'ACTIVE';

  return (
    <tr
      className={`border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors ${
        !isActive ? 'opacity-60' : ''
      }`}
      onClick={onViewScorecard}
    >
      {/* Driver */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          {driver.photoUrl ? (
            <img
              src={driver.photoUrl}
              alt={driver.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[var(--ff-primary)] flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">{driver.name}</p>
            <p className="text-xs text-[var(--ff-text-tertiary)]">
              {driver.department || 'No department'}
            </p>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDriverStatusColor(driver.status)}`}>
          {driver.status}
        </span>
      </td>

      {/* License */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <LicenseStatusIcon status={driver.licenseStatus} />
          <div>
            <p className={`text-sm font-medium ${getLicenseStatusColor(driver.licenseStatus)}`}>
              {getLicenseStatusLabel(driver.licenseStatus)}
            </p>
            {driver.licenseExpiry && (
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                Expires: {new Date(driver.licenseExpiry).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Vehicle */}
      <td className="py-3 px-4">
        {driver.hasVehicle ? (
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[var(--ff-primary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                {driver.currentVehicleReg}
              </p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {driver.vehicleMake} {driver.vehicleModel}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-sm text-[var(--ff-text-tertiary)]">No vehicle</span>
        )}
      </td>

      {/* Score */}
      <td className="py-3 px-4 text-center">
        {driver.compositeScore !== null ? (
          <span
            className={`text-lg font-bold ${
              driver.compositeScore >= 70
                ? 'text-green-500'
                : driver.compositeScore >= 50
                ? 'text-yellow-500'
                : 'text-red-500'
            }`}
          >
            {Math.round(driver.compositeScore)}
          </span>
        ) : (
          <span className="text-sm text-[var(--ff-text-tertiary)]">-</span>
        )}
      </td>

      {/* Compliance */}
      <td className="py-3 px-4 text-center">
        {driver.checkInCompliance !== null ? (
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {Math.round(driver.checkInCompliance)}%
          </span>
        ) : (
          <span className="text-sm text-[var(--ff-text-tertiary)]">-</span>
        )}
      </td>

      {/* Action */}
      <td className="py-3 px-4 text-right">
        <ChevronRight className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
      </td>
    </tr>
  );
}

export function DriversListTab({ drivers, onViewScorecard }: DriversListTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [includeFormer, setIncludeFormer] = useState(false);

  const filteredDrivers = useMemo(() => {
    return drivers.filter((driver) => {
      // Filter by active status
      if (!includeFormer && driver.status !== 'ACTIVE') {
        return false;
      }

      // Filter by search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          driver.name.toLowerCase().includes(term) ||
          driver.department?.toLowerCase().includes(term) ||
          driver.currentVehicleReg?.toLowerCase().includes(term)
        );
      }

      return true;
    });
  }, [drivers, searchTerm, includeFormer]);

  const activeCount = drivers.filter((d) => d.status === 'ACTIVE').length;
  const formerCount = drivers.filter((d) => d.status !== 'ACTIVE').length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search by name, department, or vehicle..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
          />
        </div>

        {/* Include Former Toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeFormer}
            onChange={(e) => setIncludeFormer(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-primary)] focus:ring-[var(--ff-primary)]"
          />
          <span className="text-sm text-[var(--ff-text-secondary)]">
            Include former drivers ({formerCount})
          </span>
        </label>
      </div>

      {/* Results count */}
      <p className="text-sm text-[var(--ff-text-tertiary)]">
        Showing {filteredDrivers.length} of {includeFormer ? drivers.length : activeCount} drivers
      </p>

      {/* Table */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Driver
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  License
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Vehicle
                </th>
                <th className="text-center py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Score
                </th>
                <th className="text-center py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Compliance
                </th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => (
                <DriverRow
                  key={driver.staffId}
                  driver={driver}
                  onViewScorecard={() => onViewScorecard(driver.staffId)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {filteredDrivers.length === 0 && (
          <div className="p-8 text-center">
            <User className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
              No Drivers Found
            </h3>
            <p className="text-[var(--ff-text-secondary)]">
              {searchTerm
                ? 'Try adjusting your search term'
                : 'No drivers with verified licenses found'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
