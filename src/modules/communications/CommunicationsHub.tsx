'use client';

/**
 * Communications Hub - Unified communications center
 * 6 tabs: Inbox, Email, WhatsApp, Meetings, Notifications, Settings
 * Replaces the old CommunicationsDashboard with a consolidated hub
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Inbox,
  Mail,
  MessageCircle,
  Users,
  Bell,
  Settings,
  RefreshCw,
  Film,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { useCommunications } from '@/hooks/useCommunications';
import type { CommsTab } from './types/hub.types';
import { CommunicationsStatsCards, CommunicationsMeetingsTab } from './components';
import { NotificationsTab } from './notifications/NotificationsTab';
import { EmailTab } from './email/EmailTab';
import { InboxPanel } from './messaging/InboxPanel';
import { CreateActionItemModal } from '@/modules/meetings/components/CreateActionItemModal';
import { SettingsTab } from './settings/SettingsTab';

const TABS: { key: CommsTab; label: string; icon: React.ElementType }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'meetings', label: 'Meetings', icon: Users },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function CommunicationsHub() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<CommsTab>('meetings');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingTeams, setIsSyncingTeams] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showCreateActionItem, setShowCreateActionItem] = useState(false);
  const { data, stats, isLoading, isLoadingMore, hasMoreMeetings, loadMoreMeetings, getStatusColor, refetch } = useCommunications();

  // Read ?meeting= param for deep-linking
  const initialMeetingId = router.query.meeting
    ? Number(router.query.meeting)
    : undefined;

  // Sync active tab with URL param
  useEffect(() => {
    const tabParam = router.query.tab as string | undefined;
    if (tabParam) {
      const valid = TABS.find(t => t.key === tabParam);
      if (valid) setActiveTab(valid.key);
    }
    // If meeting param present, force meetings tab
    if (router.query.meeting) {
      setActiveTab('meetings');
    }
  }, [router.query.tab, router.query.meeting]);

  const handleTabChange = (tab: CommsTab) => {
    setActiveTab(tab);
    router.push(`/communications?tab=${tab}`, undefined, { shallow: true });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (refetch) await refetch();
      setLastRefresh(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFirefliesSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/meetings?action=sync', { method: 'POST' });
      const result = await response.json();
      if (result.success) {
        setSyncMessage(`Synced ${result.synced} meetings from Fireflies`);
        await handleRefresh();
      } else {
        setSyncMessage(`Sync failed: ${result.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSyncMessage(`Sync failed: ${message}`);
      log.error('Fireflies sync failed:', error);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const handleTeamsSync = async () => {
    setIsSyncingTeams(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/meetings/sync-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 48 }),
      });
      if (response.ok) {
        setSyncMessage('Teams sync started (processing in background)');
        setTimeout(() => handleRefresh(), 5000);
      } else {
        const result = await response.json();
        setSyncMessage(`Teams sync failed: ${result.error?.message || 'Unknown error'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSyncMessage(`Teams sync failed: ${message}`);
      log.error('Teams sync failed:', error);
    } finally {
      setIsSyncingTeams(false);
      setTimeout(() => setSyncMessage(null), 8000);
    }
  };

  const showMeetingActions = activeTab === 'meetings';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Communications Hub</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {lastRefresh
              ? `Last updated ${lastRefresh.toLocaleTimeString()}`
              : 'Unified messaging, meetings, and notifications'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Meetings-specific actions */}
            {showMeetingActions && (
              <>
                <Link
                  href="/recordings"
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
                >
                  <Film className="w-4 h-4" />
                  Recordings
                </Link>

                <button
                  type="button"
                  onClick={handleTeamsSync}
                  disabled={isSyncingTeams}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    isSyncingTeams
                      ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  )}
                >
                  <RefreshCw className={cn('w-4 h-4', isSyncingTeams && 'animate-spin')} />
                  {isSyncingTeams ? 'Syncing...' : 'Sync Teams'}
                </button>

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

                <button
                  type="button"
                  onClick={() => setShowCreateActionItem(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Action Item
                </button>
              </>
            )}

            {/* Refresh button (always visible) */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            </button>
          </div>

          {syncMessage && (
            <p className={cn(
              'text-sm',
              syncMessage.includes('failed') ? 'text-red-600' : 'text-green-600'
            )}>
              {syncMessage}
            </p>
          )}
        </div>
      </div>

      {/* Stats Cards (meetings data) */}
      {showMeetingActions && <CommunicationsStatsCards stats={stats} />}

      {/* Tab Navigation */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="border-b border-[var(--ff-border-light)]">
          <nav role="tablist" className="flex gap-1 px-4 -mb-px overflow-x-auto" aria-label="Communications tabs">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`comms-panel-${tab.key}`}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'flex items-center gap-2 py-3 px-4 border-b-2 font-medium text-sm transition-colors whitespace-nowrap',
                    'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]',
                    isActive
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.key === 'meetings' && stats.totalMeetings > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
                      {stats.totalMeetings}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Panels */}
        <div className="p-6">
          {/* Inbox */}
          <div
            id="comms-panel-inbox"
            role="tabpanel"
            hidden={activeTab !== 'inbox'}
          >
            {activeTab === 'inbox' && <InboxPanel />}
          </div>

          {/* Email */}
          <div
            id="comms-panel-email"
            role="tabpanel"
            hidden={activeTab !== 'email'}
          >
            {activeTab === 'email' && <EmailTab />}
          </div>

          {/* WhatsApp */}
          <div
            id="comms-panel-whatsapp"
            role="tabpanel"
            hidden={activeTab !== 'whatsapp'}
          >
            {activeTab === 'whatsapp' && (
              <div className="text-center py-8">
                <MessageCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">WhatsApp Portal</h3>
                <p className="text-sm text-[var(--ff-text-secondary)] max-w-md mx-auto mb-4">
                  Manage WhatsApp groups, view messages, and monitor service status.
                </p>
                <Link
                  href="/communications/whatsapp"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Open WhatsApp Portal
                </Link>
              </div>
            )}
          </div>

          {/* Meetings - Working */}
          <div
            id="comms-panel-meetings"
            role="tabpanel"
            hidden={activeTab !== 'meetings'}
          >
            {activeTab === 'meetings' && (
              isLoading ? (
                <LoadingSpinner className="py-12" size="md" label="Loading meetings..." />
              ) : (
                <CommunicationsMeetingsTab
                  meetings={data.meetings}
                  getStatusColor={getStatusColor}
                  onRefresh={handleRefresh}
                  totalMeetings={stats.totalMeetings}
                  hasMore={hasMoreMeetings}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={loadMoreMeetings}
                  initialMeetingId={initialMeetingId}
                />
              )
            )}
          </div>

          {/* Notifications - Working */}
          <div
            id="comms-panel-notifications"
            role="tabpanel"
            hidden={activeTab !== 'notifications'}
          >
            {activeTab === 'notifications' && <NotificationsTab />}
          </div>

          {/* Settings */}
          <div
            id="comms-panel-settings"
            role="tabpanel"
            hidden={activeTab !== 'settings'}
          >
            {activeTab === 'settings' && <SettingsTab />}
          </div>
        </div>
      </div>
      {/* Create Action Item Modal */}
      <CreateActionItemModal
        isOpen={showCreateActionItem}
        onClose={() => setShowCreateActionItem(false)}
      />
    </div>
  );
}
