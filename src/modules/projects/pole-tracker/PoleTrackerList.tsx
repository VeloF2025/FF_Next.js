'use client';

import { useRouter } from 'next/router';
import { Plus, Download } from 'lucide-react';
import { DashboardHeader } from '../../../components/dashboard/DashboardHeader';
import { usePoleTrackers } from './hooks/usePoleTracker';
import {
  PoleTrackerFilters,
  PoleTrackerTable,
  PoleTrackerGrid,
  PoleTrackerPagination,
  usePoleTrackerList
} from './PoleTrackerList/index';

export function PoleTrackerList() {
  const router = useRouter();

  // Real data from Firebase
  const { data: poles = [], isLoading, error } = usePoleTrackers();

  const { 
    filters, 
    viewMode, 
    filteredPoles, 
    updateFilters, 
    setViewMode 
  } = usePoleTrackerList(poles);

  // Show loading state
  if (isLoading) {
    return (
      <div className="ff-page-container">
        <DashboardHeader 
          title="Pole Tracker"
          subtitle="Manage and track pole installations"
        />
        <div className="ff-data-panel">
          <div className="flex justify-center items-center py-12">
            <div className="text-[var(--ff-text-secondary)]">Loading poles...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="ff-page-container">
        <DashboardHeader 
          title="Pole Tracker"
          subtitle="Manage and track pole installations"
        />
        <div className="ff-data-panel">
          <div className="flex justify-center items-center py-12">
            <div className="text-red-500">Error loading poles: {error.message}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title="Pole Tracker"
        subtitle="Manage and track pole installations"
        actions={[
          {
            label: 'Add Pole',
            icon: ({ className }: { className?: string }) => <Plus className={className} />,
            onClick: () => router.push('/pole-tracker/new'),
            variant: 'primary'
          },
          {
            label: 'Import',
            icon: ({ className }: { className?: string }) => <Download className={className} />,
            onClick: () => router.push('/pole-tracker/import'),
            variant: 'secondary'
          }
        ]}
      />

      <PoleTrackerFilters
        filters={filters}
        viewMode={viewMode}
        onFiltersChange={updateFilters}
        onViewModeChange={setViewMode}
      />

      {/* Pole List */}
      <div className="ff-data-panel">
        {viewMode === 'list' ? (
          <PoleTrackerTable poles={filteredPoles} />
        ) : (
          <PoleTrackerGrid poles={filteredPoles} />
        )}

        <PoleTrackerPagination 
          totalItems={poles.length} 
          filteredItems={filteredPoles.length} 
        />
      </div>
    </div>
  );
}