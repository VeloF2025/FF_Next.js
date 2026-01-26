/**
 * Data Sync Page
 * Unified page for all data sync operations with grouped tabs
 *
 * URL Structure:
 * - /system/data-sync - Overview dashboard
 * - /system/data-sync?group=maintenance - Maintenance tabs
 * - /system/data-sync?group=activate - Activate tabs
 * - /system/data-sync?group=olt - OLT Report tabs
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  Database,
  RefreshCw,
  Wrench,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import type { TabGroupId } from '../types';
import { OverviewDashboard } from './OverviewDashboard';
import { MaintenanceGroup } from './groups/MaintenanceGroup';
import { ActivateGroup } from './groups/ActivateGroup';
import { OltReportGroup } from './groups/OltReportGroup';

// Tab group configuration
const TAB_GROUPS: { id: TabGroupId; label: string; icon: React.ElementType; description: string }[] = [
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: Wrench,
    description: 'QContact sync, alignments, and weekly imports',
  },
  {
    id: 'activate',
    label: 'Activate',
    icon: Zap,
    description: 'OES/ARCH imports and manual DR entry',
  },
  {
    id: 'olt',
    label: 'OLT Report',
    icon: AlertTriangle,
    description: 'Nokia OLT report import and 1Map serial fixes',
  },
];

export function DataSyncPage() {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get group and tab from URL
  const activeGroup = (router.query.group as TabGroupId) || null;
  const activeTab = (router.query.tab as string) || null;

  // Handle group change
  const handleGroupChange = (groupId: TabGroupId | null) => {
    if (groupId === null) {
      router.push('/system/data-sync', undefined, { shallow: true });
    } else {
      router.push(
        { pathname: '/system/data-sync', query: { group: groupId } },
        undefined,
        { shallow: true }
      );
    }
  };

  // Handle tab change within a group
  const handleTabChange = (groupId: TabGroupId, tabId: string) => {
    router.push(
      { pathname: '/system/data-sync', query: { group: groupId, tab: tabId } },
      undefined,
      { shallow: true }
    );
  };

  // Handle refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Get current group config
  const currentGroup = TAB_GROUPS.find((g) => g.id === activeGroup);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {activeGroup && (
            <button
              onClick={() => handleGroupChange(null)}
              className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
              title="Back to overview"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)] flex items-center gap-3">
              <Database className="w-7 h-7 text-[var(--ff-accent)]" />
              {activeGroup ? currentGroup?.label : 'Data Sync'}
            </h1>
            <p className="text-[var(--ff-text-secondary)] text-sm mt-1">
              {activeGroup
                ? currentGroup?.description
                : 'Manage data imports and synchronization across systems'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--ff-text-tertiary)]">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg transition-colors disabled:opacity-50 border border-[var(--ff-border-light)]"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Group Navigation Pills (when viewing a group) */}
      {activeGroup && (
        <div className="flex gap-2 pb-4 border-b border-[var(--ff-border-light)]">
          {TAB_GROUPS.map((group) => {
            const Icon = group.icon;
            const isActive = activeGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => handleGroupChange(group.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--ff-accent)] text-white'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {group.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div key={lastRefresh.getTime()}>
        {!activeGroup && (
          <OverviewDashboard onGroupSelect={handleGroupChange} />
        )}

        {activeGroup === 'maintenance' && (
          <MaintenanceGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('maintenance', tab)}
          />
        )}

        {activeGroup === 'activate' && (
          <ActivateGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('activate', tab)}
          />
        )}

        {activeGroup === 'olt' && (
          <OltReportGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('olt', tab)}
          />
        )}
      </div>
    </div>
  );
}
