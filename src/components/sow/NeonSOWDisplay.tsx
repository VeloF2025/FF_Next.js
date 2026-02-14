import { useState } from 'react';
import { useProjectSOW, useNeonHealth } from '@/hooks/useNeonSOW';

// Import split components
import { NeonSOWDisplayProps, NeonTabType } from './neon/NeonSOWTypes';
import { 
  NeonSOWLoadingState, 
  NeonSOWErrorState, 
  NeonSOWEmptyState 
} from './neon/NeonSOWLoadingStates';
import { NeonSOWHeader } from './neon/NeonSOWHeader';
import { NeonSOWTabs } from './neon/NeonSOWTabs';
import { NeonSOWSummary } from './neon/NeonSOWSummary';
import { NeonSOWDataTables } from './neon/NeonSOWDataTables';

export function NeonSOWDisplay({ projectId }: NeonSOWDisplayProps) {
  const [activeTab, setActiveTab] = useState<NeonTabType>('summary');
  
  const { data: sowData, isLoading, error } = useProjectSOW(projectId);
  const { data: neonHealth } = useNeonHealth();

  if (isLoading) {
    return <NeonSOWLoadingState />;
  }

  if (error || !sowData?.success) {
    return (
      <NeonSOWErrorState 
        error={sowData?.error || error?.message || 'Unknown error accessing Neon database'}
        {...(neonHealth?.connected !== undefined && { neonConnected: neonHealth.connected })}
      />
    );
  }

  const { poles = [], drops = [], fibre = [], summary } = sowData.data || {};

  // If no data exists
  if (summary.totalPoles === 0 && summary.totalDrops === 0 && summary.totalFibre === 0) {
    return <NeonSOWEmptyState />;
  }


  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <NeonSOWHeader {...(neonHealth && { neonHealth })} />
      
      <NeonSOWTabs 
        activeTab={activeTab}
        onTabChange={setActiveTab}
        summary={summary}
      />

      <div className="p-6">
        {activeTab === 'summary' && (
          <NeonSOWSummary summary={summary} {...(neonHealth && { neonHealth })} />
        )}

        {activeTab === 'poles' && (
          <NeonSOWDataTables 
            data={poles} 
            type="poles" 
            title="Poles Data" 
          />
        )}

        {activeTab === 'drops' && (
          <NeonSOWDataTables 
            data={drops} 
            type="drops" 
            title="Drops Data" 
          />
        )}

        {activeTab === 'fibre' && (
          <NeonSOWDataTables 
            data={fibre} 
            type="fibre" 
            title="Fibre Segments" 
          />
        )}
      </div>
    </div>
  );
}