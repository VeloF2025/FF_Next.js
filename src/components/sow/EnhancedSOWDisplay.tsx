import { useState } from 'react';
import { useProjectSOW, useProjectPoles, useProjectDrops, useProjectFibre } from '@/hooks/useNeonSOW';
import { SOWUploadSection } from '@/modules/projects/components/SOWUploadSection';

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

export function EnhancedSOWDisplay({ projectId, projectName = 'Project' }: EnhancedSOWDisplayProps) {
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [showUploadWizard, setShowUploadWizard] = useState(false);
  
  const { data: sowData, isLoading } = useProjectSOW(projectId);
  const { data: poles = [] } = useProjectPoles(projectId);
  const { data: drops = [] } = useProjectDrops(projectId);
  const { data: fibre = [] } = useProjectFibre(projectId);

  const hasData = poles.length > 0 || drops.length > 0 || fibre.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading SOW data...</span>
      </div>
    );
  }

  // If no data exists, show upload prompt
  if (!hasData && !showUploadWizard) {
    return <SOWEmptyState onImportClick={() => setShowUploadWizard(true)} />;
  }

  // Show upload wizard if requested
  if (showUploadWizard) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Import SOW Data</h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Upload Excel files containing poles, drops, and fibre scope data
          </p>
        </div>
        
        <SOWUploadSection
          projectId={projectId}
          projectName={projectName}
          onComplete={() => {
            setShowUploadWizard(false);
            setActiveTab('summary');
          }}
        />
        
        <div className="mt-6 pt-6 border-t border-[var(--ff-border-light)]">
          <button
            onClick={() => setShowUploadWizard(false)}
            className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            Cancel and go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      {/* Header */}
      <SOWHeader 
        hasData={hasData}
        onUpdateClick={() => setActiveTab('upload')}
      />

      {/* Tabs */}
      <SOWTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        polesCount={poles.length}
        dropsCount={drops.length}
        fibreCount={fibre.length}
      />

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            <SOWSummaryCards
              polesCount={poles.length}
              dropsCount={drops.length}
              fibreCount={fibre.length}
            />
            
            <SOWDataStatus
              sowData={sowData}
              polesCount={poles.length}
              dropsCount={drops.length}
              fibreCount={fibre.length}
            />
            
            <SOWStatistics
              poles={poles}
              drops={drops}
            />
          </div>
        )}

        {activeTab === 'poles' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Poles Data</h3>
              <span className="text-sm text-gray-500">{poles.length} total poles</span>
            </div>
            <SOWDataTable type="poles" data={poles} />
          </div>
        )}

        {activeTab === 'drops' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Drops Data</h3>
              <span className="text-sm text-gray-500">{drops.length} total drops</span>
            </div>
            <SOWDataTable type="drops" data={drops} />
          </div>
        )}

        {activeTab === 'fibre' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Fibre Segments</h3>
              <span className="text-sm text-gray-500">{fibre.length} total segments</span>
            </div>
            <SOWDataTable type="fibre" data={fibre} />
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Import or Update SOW Data</h3>
              <p className="text-sm text-gray-600">
                Upload new Excel files to add or update poles, drops, and fibre scope data for this project.
              </p>
            </div>
            
            <SOWUploadSection
              projectId={projectId}
              projectName={projectName}
              onComplete={() => {
                setActiveTab('summary');
              }}
              showActions={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}