/**
 * EOD Group Component
 * Wraps End-of-Day install sheet tabs: Upload, Reconciliation, History
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { Upload, GitCompare, Clock, Lock, Loader2 } from 'lucide-react';
import type { EodTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

import { EodUploadTab } from './eod/EodUploadTab';
import { EodReconciliationTab } from './eod/EodReconciliationTab';
import { EodHistoryTab } from './eod/EodHistoryTab';

const TABS: { id: EodTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'upload',          label: 'Upload',          icon: Upload,     permissionKey: 'system.data-sync.eod.upload' },
  { id: 'reconciliation',  label: 'Reconciliation',  icon: GitCompare, permissionKey: 'system.data-sync.eod.reconciliation' },
  { id: 'history',         label: 'History',          icon: Clock,      permissionKey: 'system.data-sync.eod.history' },
];

interface EodGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function EodGroup({ activeTab, onTabChange }: EodGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();

  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter((tab) => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  const currentTab = useMemo(() => {
    const requested = activeTab as EodTabId;
    if (accessibleTabs.some((t) => t.id === requested)) return requested;
    return accessibleTabs[0]?.id || 'upload';
  }, [activeTab, accessibleTabs]);

  useEffect(() => {
    const firstTab = accessibleTabs[0];
    if (!activeTab && firstTab) onTabChange(firstTab.id);
  }, [activeTab, onTabChange, accessibleTabs]);

  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading...</span>
      </div>
    );
  }

  if (accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any EOD tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="EOD Tabs">
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
      {currentTab === 'upload' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              EOD Install Sheet Upload
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Photograph or upload a technician&apos;s End-of-Day install sheet for VLM extraction
            </p>
          </div>
          <EodUploadTab />
        </div>
      )}

      {currentTab === 'reconciliation' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              3-Way Reconciliation
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Compare EOD sheet entries with WhatsApp DR submissions and OES activations
            </p>
          </div>
          <EodReconciliationTab />
        </div>
      )}

      {currentTab === 'history' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Upload History
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              View all uploaded EOD install sheets with dates, technicians, and entry counts
            </p>
          </div>
          <EodHistoryTab />
        </div>
      )}
    </div>
  );
}
