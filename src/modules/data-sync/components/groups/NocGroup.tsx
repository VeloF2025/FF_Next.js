/**
 * Maintenance Group Component
 * Wraps maintenance sync tabs: QContact Sync, Alignment, 3-Way Alignment, Weekly Import, WA Tracking
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  GitCompare,
  FileSpreadsheet,
  FileUp,
  MessageSquare,
  Loader2,
  Lock,
} from 'lucide-react';
import type { NocTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

// Import existing maintenance components
import { SyncDashboard } from '@/modules/noc/components/QContact/SyncDashboard';
import { SyncTrigger } from '@/modules/noc/components/QContact/SyncTrigger';
import { SyncAuditLog } from '@/modules/noc/components/QContact/SyncAuditLog';
import { AlignmentReport } from '@/modules/noc/components/QContact/AlignmentReport';
import { ThreeWayAlignmentReport } from '@/modules/noc/components/ThreeWayAlignmentReport';
import { WeeklyImportWizard } from '@/modules/noc/components/WeeklyImport/WeeklyImportWizard';
import { WATrackingDashboard } from '@/modules/noc/components/WATrackingDashboard';
import { useTriggerManualSync } from '@/modules/noc/hooks/useQContactSync';
import { WeeklyImportHistory } from './noc/WeeklyImportHistory';

// Tab configuration with permission keys
const TABS: { id: NocTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'qcontact', label: 'QContact Sync', icon: RefreshCw, permissionKey: 'system.data-sync.noc.qcontact' },
  { id: 'alignment', label: 'QC Alignment', icon: GitCompare, permissionKey: 'system.data-sync.noc.alignment' },
  { id: 'three-way', label: '3-Way Alignment', icon: FileSpreadsheet, permissionKey: 'system.data-sync.noc.three-way' },
  { id: 'weekly', label: 'Weekly Import', icon: FileUp, permissionKey: 'system.data-sync.noc.weekly' },
  { id: 'wa-tracking', label: 'Offline Tracking', icon: MessageSquare, permissionKey: 'system.data-sync.noc.wa-tracking' },
];

interface NocGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function NocGroup({ activeTab, onTabChange }: NocGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const triggerSync = useTriggerManualSync();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter(tab => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  // Default to first accessible tab
  const currentTab = useMemo(() => {
    const requested = activeTab as NocTabId;
    if (accessibleTabs.some(t => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'qcontact';
  }, [activeTab, accessibleTabs]);

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab && accessibleTabs.length > 0) {
      onTabChange(accessibleTabs[0].id);
    }
  }, [activeTab, onTabChange, accessibleTabs]);

  // Show loading state
  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Show access denied if no tabs accessible
  if (accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any Maintenance tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Maintenance Tabs">
          {accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${
                    isActive
                      ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {currentTab === 'qcontact' && (
        <div>
          {/* Sync Dashboard */}
          <div className="mb-6">
            <SyncDashboard />
          </div>

          {/* Manual Sync Trigger */}
          <div className="mb-6">
            <SyncTrigger
              onTriggerSync={triggerSync.mutateAsync}
              disabled={triggerSync.isPending}
            />
          </div>

          {/* Toggle for Audit Log */}
          <div className="mb-4">
            <button
              onClick={() => setShowAuditLog(!showAuditLog)}
              className="px-4 py-2 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              {showAuditLog ? 'Hide Audit Log' : 'View Audit Log'}
            </button>
          </div>

          {/* Sync Audit Log */}
          {showAuditLog && (
            <div>
              <SyncAuditLog />
            </div>
          )}
        </div>
      )}

      {currentTab === 'alignment' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <AlignmentReport />
        </div>
      )}

      {currentTab === 'three-way' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <ThreeWayAlignmentReport />
        </div>
      )}

      {currentTab === 'weekly' && (
        <div>
          <div className="mb-4">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-4 py-2 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              {showHistory ? 'Hide History' : 'View Import History'}
            </button>
          </div>

          {showHistory ? (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">
                Import History
              </h2>
              <WeeklyImportHistory />
            </div>
          ) : (
            <WeeklyImportWizard />
          )}
        </div>
      )}

      {currentTab === 'wa-tracking' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <WATrackingDashboard />
        </div>
      )}
    </div>
  );
}

