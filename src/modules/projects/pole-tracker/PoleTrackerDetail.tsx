'use client';

/**
 * Pole Tracker Detail - Legacy Compatibility Layer
 * @deprecated Use modular components from './components' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './components' directly
 */

import { useRouter } from 'next/router';
import { ArrowLeft, Edit } from 'lucide-react';
import { DashboardHeader } from '../../../components/dashboard/DashboardHeader';
import { 
  PoleOverview,
  PolePhotos,
  PoleQuality,
  PoleStats,
  PoleHistory,
  PoleTabs
} from './components';
import { usePoleDetail } from './hooks/usePoleDetail';

export function PoleTrackerDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { pole, tabs, activeTab, handleTabChange } = usePoleDetail(id);

  // Handle loading state while pole data is being fetched
  if (!pole) {
    return (
      <div className="ff-page-container">
        <DashboardHeader 
          title="Pole Details"
          subtitle="Loading..."
          actions={[
            {
              label: 'Back to List',
              icon: ArrowLeft as React.ComponentType<{ className?: string; }>,
              onClick: () => router.push('/pole-tracker'),
              variant: 'secondary'
            }
          ]}
        />
        <div className="p-6 text-center text-gray-500">
          Loading pole data...
        </div>
      </div>
    );
  }

  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title={`Pole ${pole.vfPoleId}`}
        subtitle={`${pole.projectName} - ${pole.location}`}
        actions={[
          {
            label: 'Back to List',
            icon: ArrowLeft as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push('/pole-tracker'),
            variant: 'secondary'
          },
          {
            label: 'Edit Pole',
            icon: Edit as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push(`/pole-tracker/${id}/edit`),
            variant: 'primary'
          }
        ]}
      />

      <PoleStats pole={pole} />

      <PoleTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <div className="ff-tab-content">
        {activeTab === 'overview' && <PoleOverview pole={pole} />}
        {activeTab === 'photos' && <PolePhotos photos={pole.photos} />}
        {activeTab === 'quality' && <PoleQuality qualityChecks={pole.qualityChecks} />}
        {activeTab === 'history' && <PoleHistory />}
      </div>
    </div>
  );
}