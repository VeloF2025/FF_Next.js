import { useState } from 'react';
import { useProjectSOW, useProjectPoles, useProjectDrops, useProjectFibre } from '@/hooks/useNeonSOW';

// Import split components
import { SOWEmptyState } from './enhanced/SOWEmptyState';
import { SOWHeader } from './enhanced/SOWHeader';
import { SOWTabs, type TabType } from './enhanced/SOWTabs';
import { SOWSummaryCards } from './enhanced/SOWSummaryCards';
import { SOWDataStatus } from './enhanced/SOWDataStatus';
import { SOWStatistics } from './enhanced/SOWStatistics';
import { SOWDataTable } from './enhanced/SOWDataTable';

interface EnhancedSOWDisplayProps {
  projectId: string;
  projectName?: string;
}

export function EnhancedSOWDisplay({ projectId }: EnhancedSOWDisplayProps) {
  const [activeTab, setActiveTab] = useState<TabType>('summary');

  const { data: sowData, isLoading } = useProjectSOW(projectId);
  const { data: poles = [] } = useProjectPoles(projectId);
  const { data: drops = [] } = useProjectDrops(projectId);
  const { data: fibre = [] } = useProjectFibre(projectId);

  // Use summary counts from API (accurate) instead of array lengths (limited to 1000)
  const summary = sowData?.data?.summary;
  const totalPoles = summary?.totalPoles ?? poles.length;
  const totalDrops = summary?.totalDrops ?? drops.length;
  const totalFibre = summary?.totalFibre ?? fibre.length;

  const hasData = totalPoles > 0 || totalDrops > 0 || totalFibre > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading SOW data...</span>
      </div>
    );
  }

  // If no data exists, show empty state (upload via Documents tab)
  if (!hasData) {
    return <SOWEmptyState />;
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      {/* Header */}
      <SOWHeader hasData={hasData} />

      {/* Tabs */}
      <SOWTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        polesCount={totalPoles}
        dropsCount={totalDrops}
        fibreCount={totalFibre}
      />

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            <SOWSummaryCards
              polesCount={totalPoles}
              dropsCount={totalDrops}
              fibreCount={totalFibre}
            />

            <SOWDataStatus
              sowData={sowData}
              polesCount={totalPoles}
              dropsCount={totalDrops}
              fibreCount={totalFibre}
            />

            <SOWStatistics
              poles={poles}
              drops={drops}
              totalPoles={totalPoles}
              totalDrops={totalDrops}
            />
          </div>
        )}

        {activeTab === 'poles' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Poles Data</h3>
              <span className="text-sm text-[var(--ff-text-secondary)]">{totalPoles.toLocaleString()} total poles</span>
            </div>
            <SOWDataTable type="poles" data={poles} totalCount={totalPoles} />
          </div>
        )}

        {activeTab === 'drops' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Drops Data</h3>
              <span className="text-sm text-[var(--ff-text-secondary)]">{totalDrops.toLocaleString()} total drops</span>
            </div>
            <SOWDataTable type="drops" data={drops} totalCount={totalDrops} />
          </div>
        )}

        {activeTab === 'fibre' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Fibre Segments</h3>
              <span className="text-sm text-[var(--ff-text-secondary)]">{totalFibre.toLocaleString()} total segments</span>
            </div>
            <SOWDataTable type="fibre" data={fibre} totalCount={totalFibre} />
          </div>
        )}
      </div>
    </div>
  );
}