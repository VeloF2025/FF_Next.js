/**
 * Staff List Header Component
 */

import { Users, Plus, Upload, Settings, Filter, Download } from 'lucide-react';
import { PermissionGate } from '@/components/PermissionGate';
import type { StaffFilter } from '@/types/staff.types';

interface StaffListHeaderProps {
  totalStaff: number;
  activeStaff: number;
  utilizationRate: number;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  onAddStaff: () => void;
  onImport: () => void;
  onSettings: () => void;
  onExport: () => void;
  filter?: StaffFilter;
}

export function StaffListHeader({
  totalStaff,
  activeStaff,
  utilizationRate,
  showFilters,
  setShowFilters,
  onAddStaff,
  onImport,
  onSettings,
  onExport,
  filter
}: StaffListHeaderProps) {
  // Build export label based on active filters
  const hasFilters = filter?.status || filter?.department || filter?.position || filter?.searchTerm;
  const exportLabel = hasFilters
    ? `Export ${filter?.status || 'Filtered'}`
    : 'Export All';
  return (
    <div className="bg-[var(--ff-bg-secondary)] shadow-sm border-b border-[var(--ff-border-light)]">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-blue-500 mr-3" />
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Staff Management</h1>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {totalStaff} total staff • {activeStaff} active • {utilizationRate}% utilization
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 border rounded-md text-sm font-medium flex items-center ${
                showFilters ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </button>
            <button
              onClick={onExport}
              title={`Export ${hasFilters ? 'filtered' : 'all'} staff to CSV`}
              className="px-4 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
            >
              <Download className="h-4 w-4 mr-2" />
              {exportLabel}
            </button>
            <PermissionGate permission="people.staff" action="create">
              <button
                onClick={onImport}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import
              </button>
            </PermissionGate>
            <PermissionGate permission="people.staff" action="edit">
              <button
                onClick={onSettings}
                className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                title="Staff Settings"
              >
                <Settings className="h-5 w-5" />
              </button>
            </PermissionGate>
            <PermissionGate permission="people.staff" action="create">
              <button
                onClick={onAddStaff}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Staff
              </button>
            </PermissionGate>
          </div>
        </div>
      </div>
    </div>
  );
}