'use client';

/**
 * Communications Dashboard Component
 *
 * Following Maintenance Dashboard pattern:
 * - Inline header (not using DashboardHeader component)
 * - Styled action buttons
 * - Stat cards with small icon + label at top
 *
 * @see src/modules/maintenance/components/Dashboard/TicketingDashboard.tsx
 */

import React, { useState } from 'react';
import { Plus, Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { data, stats, getPriorityColor, getStatusColor, refetch } = useCommunications();

  const tabs = ['Overview', 'Meetings', 'Action Items', 'Notifications'];

  // Handle refresh with loading state
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (refetch) await refetch();
      setLastRefresh(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header - Inline style matching Maintenance Dashboard */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Communications Portal</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {lastRefresh
              ? `Last updated ${lastRefresh.toLocaleTimeString()}`
              : 'Meetings, action items, and team notifications'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {}}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--ff-primary)] hover:bg-[var(--ff-primary-hover)] rounded-lg transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Schedule Meeting
          </button>
          <button
            type="button"
            onClick={() => {}}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Action Item
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Stats Cards - Maintenance Dashboard pattern */}
      <CommunicationsStatsCards stats={stats} />

      {/* Tabs Container */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="flex gap-1 px-4 -mb-px" aria-label="Tabs">
            {tabs.map((tab, index) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(index as CommunicationsTab)}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  selectedTab === index
                    ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
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