/**
 * Data Sync Page
 * Unified page for all data sync operations with grouped tabs
 *
 * URL Structure:
 * - /system/data-sync - Overview dashboard
 * - /system/data-sync?group=maintenance - Maintenance tabs
 * - /system/data-sync?group=activate - Activate tabs
 * - /system/data-sync?group=olt - OLT Report tabs
 *
 * Access Control:
 * - Groups and tabs are filtered by both RBAC permissions and feature settings
 * - Feature settings can be toggled in Settings > System
 * - RBAC permissions are managed in Settings > Access Control
 */

'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  Database,
  RefreshCw,
  Wrench,
  Zap,
  AlertTriangle,
  MapPin,
  Clock,
  Lock,
  Loader2,
  CreditCard,
  ClipboardList,
} from 'lucide-react';
import type { TabGroupId } from '../types';
import { OverviewDashboard } from './OverviewDashboard';
import { NocGroup } from './groups/NocGroup';
import { ActivateGroup } from './groups/ActivateGroup';
import { OltReportGroup } from './groups/OltReportGroup';
import { EodGroup } from './groups/EodGroup';
import { QFieldGroup } from './groups/QFieldGroup';
import { HistoryGroup } from './groups/HistoryGroup';
import { BillingGroup } from './groups/BillingGroup';
import { usePermission } from '@/hooks/usePermission';
import { useSystemFeatures } from '../hooks/useSystemFeatures';
import { Button } from '@/components/ui/button';

// Permission keys for each group
const GROUP_PERMISSION_KEYS: Record<TabGroupId, string> = {
  noc: 'system.data-sync.noc',
  activate: 'system.data-sync.activate',
  olt: 'system.data-sync.olt',
  eod: 'system.data-sync.eod',
  qfield: 'system.data-sync.qfield',
  history: 'system.data-sync.history',
  billing: 'system.data-sync.billing',
};

// Tab group configuration
const TAB_GROUPS: {
  id: TabGroupId;
  label: string;
  icon: React.ElementType;
  description: string;
}[] = [
  {
    id: 'noc',
    label: 'NOC',
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
  {
    id: 'eod',
    label: 'EOD',
    icon: ClipboardList,
    description: 'End-of-Day install sheet upload and reconciliation',
  },
  {
    id: 'qfield',
    label: 'QField',
    icon: MapPin,
    description: 'QFieldCloud projects for OES and data sync targets',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'FiberTime weekly billing reconciliation',
  },
  {
    id: 'history',
    label: 'History',
    icon: Clock,
    description: 'Unified timeline of all sync and import operations',
  },
];

interface DataSyncPageProps {
  /** Optional filter to show only specific groups (e.g. ['activate','olt'] for Activation Ops) */
  groupFilter?: TabGroupId[];
}

export function DataSyncPage({ groupFilter }: DataSyncPageProps) {
  const router = useRouter();
  const searchParams = { get: (key: string) => (router.query[key] as string) || null };
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Permission and feature hooks
  const { can, isLoading: permissionsLoading } = usePermission();
  const { isFeatureEnabled, isLoading: featuresLoading } = useSystemFeatures();

  // Get group and tab from URL (App Router)
  const activeGroup = (searchParams.get('group') as TabGroupId) || null;
  const activeTab = searchParams.get('tab') || null;

  // Show loading state while permissions are being resolved
  const isLoading = permissionsLoading || featuresLoading;

  // Filter groups based on permissions and feature settings
  const accessibleGroups = useMemo(() => {
    // Don't show any groups while loading to prevent flash of unauthorized content
    if (permissionsLoading || featuresLoading) {
      return [];
    }

    const filtered = groupFilter
      ? TAB_GROUPS.filter((g) => groupFilter.includes(g.id))
      : TAB_GROUPS;

    return filtered.filter((group) => {
      const permissionKey = GROUP_PERMISSION_KEYS[group.id];

      // Check RBAC permission
      const hasPermission = can(permissionKey, 'view');

      // Check feature setting
      const featureEnabled = isFeatureEnabled(permissionKey);

      return hasPermission && featureEnabled;
    });
  }, [permissionsLoading, featuresLoading, can, isFeatureEnabled, groupFilter]);

  // Check if current group is accessible
  const currentGroupAccessible = useMemo(() => {
    if (!activeGroup) return true;
    return accessibleGroups.some((g) => g.id === activeGroup);
  }, [activeGroup, accessibleGroups]);

  // Handle group change — use current pathname so it works from any mount point
  const basePath = router.pathname;
  const handleGroupChange = (groupId: TabGroupId | null) => {
    if (groupId === null) {
      router.push(basePath);
    } else {
      router.push(`${basePath}?group=${groupId}`);
    }
  };

  // Handle tab change within a group
  const handleTabChange = (groupId: TabGroupId, tabId: string) => {
    router.push(`${basePath}?group=${groupId}&tab=${tabId}`);
  };

  // Handle refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Get current group config
  const currentGroup = TAB_GROUPS.find((g) => g.id === activeGroup);

  // Show loading state while permissions are being resolved
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
          <p className="text-[var(--ff-text-secondary)]">Loading permissions...</p>
        </div>
      </div>
    );
  }

  // Show access denied if trying to access a group without permission
  if (activeGroup && !currentGroupAccessible && !permissionsLoading && !featuresLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleGroupChange(null)}
            title="Back to overview"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)] flex items-center gap-3">
              <Database className="w-7 h-7 text-[var(--ff-accent)]" />
              Access Denied
            </h1>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <Lock className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
            Access Restricted
          </h2>
          <p className="text-[var(--ff-text-secondary)] max-w-md">
            You don&apos;t have permission to access the {currentGroup?.label || activeGroup} section,
            or this feature has been disabled by an administrator.
          </p>
          <Button
            variant="secondary"
            onClick={() => handleGroupChange(null)}
            className="mt-6"
          >
            Return to Overview
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {activeGroup && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleGroupChange(null)}
              title="Back to overview"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
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
          <Button
            variant="secondary"
            onClick={() => { void handleRefresh(); }}
            disabled={isRefreshing}
            loading={isRefreshing}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Group Navigation Pills (when viewing a group) */}
      {activeGroup && (
        <div className="flex gap-2 pb-4 border-b border-[var(--ff-border-light)] overflow-x-auto scrollbar-hide">
          {accessibleGroups.map((group) => {
            const Icon = group.icon;
            const isActive = activeGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => handleGroupChange(group.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
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
          <OverviewDashboard
            onGroupSelect={handleGroupChange}
            accessibleGroups={accessibleGroups.map((g) => g.id)}
          />
        )}

        {activeGroup === 'noc' && (
          <NocGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('noc', tab)}
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

        {activeGroup === 'eod' && (
          <EodGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('eod', tab)}
          />
        )}

        {activeGroup === 'qfield' && (
          <QFieldGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('qfield', tab)}
          />
        )}

        {activeGroup === 'billing' && (
          <BillingGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('billing', tab)}
          />
        )}

        {activeGroup === 'history' && (
          <HistoryGroup
            activeTab={activeTab}
            onTabChange={(tab) => handleTabChange('history', tab)}
          />
        )}
      </div>
    </div>
  );
}
