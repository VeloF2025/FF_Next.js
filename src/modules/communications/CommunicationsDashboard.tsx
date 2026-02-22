'use client';

/**
 * Communications Dashboard Component
 *
 * Following Maintenance Dashboard pattern:
 * - Inline header (not using DashboardHeader component)
 * - Styled action buttons
 * - Stat cards with small icon + label at top
 *
 * Now integrated with Meetings module from Fireflies
 *
 * @see src/modules/maintenance/components/Dashboard/TicketingDashboard.tsx
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, Calendar, RefreshCw, Video, Film } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import { useCommunications } from '@/hooks/useCommunications';
import { CommunicationsTab } from '@/types/communications.types';
import {
  CommunicationsStatsCards,
  CommunicationsOverviewTab,
  CommunicationsMeetingsTab,
  CommunicationsActionTab,
  CommunicationsNotificationsTab
} from './components';
import { ScheduleMeetingModal } from '@/modules/livekit/components/ScheduleMeetingModal';
import { notificationService } from '@/services/core/NotificationService';

// Tab name mapping for URL params
const TAB_NAMES = ['overview', 'meetings', 'action-items', 'notifications'];

const CommunicationsDashboard: React.FC = () => {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<CommunicationsTab>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const { data, stats, isLoading, getPriorityColor, getStatusColor, refetch } = useCommunications();

  const tabs = ['Overview', 'Meetings', 'Action Items', 'Notifications'];

  // Handle URL params for tab selection
  useEffect(() => {
    if (router.isReady) {
      const tabParam = router.query.tab as string;
      if (tabParam) {
        const tabIndex = TAB_NAMES.indexOf(tabParam.toLowerCase());
        if (tabIndex !== -1) {
          setSelectedTab(tabIndex as CommunicationsTab);
        }
      }
    }
  }, [router.isReady, router.query.tab]);

  // Update URL when tab changes
  const handleTabChange = (index: CommunicationsTab) => {
    setSelectedTab(index);
    const tabName = TAB_NAMES[index];
    router.push(`/communications?tab=${tabName}`, undefined, { shallow: true });
  };

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

  // Handle Fireflies sync
  const handleFirefliesSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);

    try {
      const response = await fetch('/api/meetings?action=sync', {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        setSyncMessage(`✓ Synced ${data.synced} meetings from Fireflies`);
        // Reload meetings after sync
        await handleRefresh();
      } else {
        setSyncMessage(`✗ Sync failed: ${data.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSyncMessage(`✗ Sync failed: ${message}`);
      log.error('Fireflies sync failed:', error);
    } finally {
      setIsSyncing(false);
      // Clear message after 5 seconds
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  // Handle Start Now button - create LiveKit room
  const handleStartVideoMeeting = async () => {
    setIsCreatingRoom(true);
    try {
      const response = await fetch('/api/livekit/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Meeting ${new Date().toLocaleString()}` }),
      });
      const responseData = await response.json();
      if (responseData.success && responseData.room) {
        router.push(`/livekit/${responseData.room.name}`);
      } else {
        notificationService.error('Failed to create meeting: ' + (responseData.error || 'Unknown error'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error('Failed to create meeting: ' + message);
      log.error('Failed to create video meeting:', error);
    } finally {
      setIsCreatingRoom(false);
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

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Schedule Meeting - Primary indigo */}
            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Schedule Meeting
            </button>

            {/* Start Now - Green */}
            <button
              type="button"
              onClick={handleStartVideoMeeting}
              disabled={isCreatingRoom}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                isCreatingRoom
                  ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              )}
            >
              <Video className="w-4 h-4" />
              {isCreatingRoom ? 'Creating...' : 'Start Now'}
            </button>

            {/* Recordings - Secondary */}
            <Link
              href="/recordings"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
            >
              <Film className="w-4 h-4" />
              Recordings
            </Link>

            {/* Sync Fireflies - Blue */}
            <button
              type="button"
              onClick={handleFirefliesSync}
              disabled={isSyncing}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                isSyncing
                  ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', isSyncing && 'animate-spin')} />
              {isSyncing ? 'Syncing...' : 'Sync Fireflies'}
            </button>

            {/* Add Action Item - Secondary */}
            <button
              type="button"
              onClick={() => {}}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Action Item
            </button>

            {/* Refresh button */}
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

          {/* Sync message */}
          {syncMessage && (
            <p className={cn(
              'text-sm',
              syncMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'
            )}>
              {syncMessage}
            </p>
          )}
        </div>
      </div>

      {/* Stats Cards - Maintenance Dashboard pattern */}
      <CommunicationsStatsCards stats={stats} />

      {/* Tabs Container */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="border-b border-[var(--ff-border-light)]">
          {/* WCAG: role=tablist on nav, role=tab + aria-selected + aria-controls on each button */}
          <nav role="tablist" className="flex gap-1 px-4 -mb-px" aria-label="Communications tabs">
            {tabs.map((tab, index) => {
              const tabId = `comms-tab-${tab.toLowerCase().replace(/\s+/g, '-')}`;
              const panelId = `comms-panel-${tab.toLowerCase().replace(/\s+/g, '-')}`;
              return (
                <button
                  key={tab}
                  id={tabId}
                  role="tab"
                  aria-selected={selectedTab === index}
                  aria-controls={panelId}
                  onClick={() => handleTabChange(index as CommunicationsTab)}
                  className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)] ${
                    selectedTab === index
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                  }`}
                >
                  {tab}
                  {/* Show count badge for Meetings tab */}
                  {index === 1 && data.meetings.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full" aria-hidden="true">
                      {data.meetings.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-label="Loading communications">
              <RefreshCw className="w-6 h-6 animate-spin text-[var(--ff-text-tertiary)]" aria-hidden="true" />
              <span className="ml-2 text-[var(--ff-text-secondary)]">Loading...</span>
            </div>
          ) : (
            <>
              {/* WCAG: role=tabpanel + id (matches aria-controls) + aria-labelledby (matches tab id) */}
              <div
                id="comms-panel-overview"
                role="tabpanel"
                aria-labelledby="comms-tab-overview"
                hidden={selectedTab !== 0}
              >
                <CommunicationsOverviewTab
                  meetings={data.meetings}
                  actionItems={data.actionItems}
                  getStatusColor={getStatusColor}
                  getPriorityColor={getPriorityColor}
                />
              </div>

              <div
                id="comms-panel-meetings"
                role="tabpanel"
                aria-labelledby="comms-tab-meetings"
                hidden={selectedTab !== 1}
              >
                <CommunicationsMeetingsTab
                  meetings={data.meetings}
                  getStatusColor={getStatusColor}
                  onRefresh={handleRefresh}
                />
              </div>

              <div
                id="comms-panel-action-items"
                role="tabpanel"
                aria-labelledby="comms-tab-action-items"
                hidden={selectedTab !== 2}
              >
                <CommunicationsActionTab
                  actionItems={data.actionItems}
                  meetings={data.meetings}
                  getStatusColor={getStatusColor}
                  getPriorityColor={getPriorityColor}
                />
              </div>

              <div
                id="comms-panel-notifications"
                role="tabpanel"
                aria-labelledby="comms-tab-notifications"
                hidden={selectedTab !== 3}
              >
                <CommunicationsNotificationsTab
                  notifications={data.notifications}
                  getPriorityColor={getPriorityColor}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Schedule Meeting Modal */}
      <ScheduleMeetingModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSuccess={() => {
          handleRefresh();
        }}
      />
    </div>
  );
};

export default CommunicationsDashboard;
