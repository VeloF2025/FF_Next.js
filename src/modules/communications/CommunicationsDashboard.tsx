import React, { useState } from 'react';
import { Plus, Calendar } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { useCommunications } from '@/hooks/useCommunications';
import { CommunicationsTab } from '@/types/communications.types';
import {
  CommunicationsStatsCards,
  CommunicationsOverviewTab,
  CommunicationsMeetingsTab,
  CommunicationsActionTab,
  CommunicationsNotificationsTab
} from './components';

const CommunicationsDashboard: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState<CommunicationsTab>(0);
  const { data, stats, getPriorityColor, getStatusColor } = useCommunications();
  
  const tabs = ['Overview', 'Meetings', 'Action Items', 'Notifications'];

  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title="Communications Portal"
        subtitle="Meetings, action items, and team notifications"
        actions={[
          {
            label: 'Schedule Meeting',
            icon: Calendar as React.ComponentType<{ className?: string; }>,
            onClick: () => {},
            variant: 'primary'
          },
          {
            label: 'Add Action Item',
            icon: Plus as React.ComponentType<{ className?: string; }>,
            onClick: () => {},
            variant: 'secondary'
          }
        ]}
      />

      <CommunicationsStatsCards stats={stats} />

      <div className="ff-card mb-6">
        <div className="border-b">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab, index) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(index as CommunicationsTab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  selectedTab === index
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {selectedTab === 0 && (
            <CommunicationsOverviewTab 
              meetings={data.meetings}
              actionItems={data.actionItems}
              getStatusColor={getStatusColor}
              getPriorityColor={getPriorityColor}
            />
          )}

          {selectedTab === 1 && (
            <CommunicationsMeetingsTab 
              meetings={data.meetings}
              getStatusColor={getStatusColor}
            />
          )}

          {selectedTab === 2 && (
            <CommunicationsActionTab 
              actionItems={data.actionItems}
              meetings={data.meetings}
              getStatusColor={getStatusColor}
              getPriorityColor={getPriorityColor}
            />
          )}

          {selectedTab === 3 && (
            <CommunicationsNotificationsTab 
              notifications={data.notifications}
              getPriorityColor={getPriorityColor}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CommunicationsDashboard;