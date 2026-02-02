/**
 * QField Group - Manages QFieldCloud projects as import targets
 * Tab: Projects (CRUD for QField project registry)
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { MapPin, Loader2, Lock } from 'lucide-react';
import type { QFieldTabId } from '../../types';
import { QFieldProjectsTab } from './qfield/QFieldProjectsTab';
import { usePermission } from '@/hooks/usePermission';

const TABS: { id: QFieldTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'projects', label: 'Projects', icon: MapPin, permissionKey: 'system.data-sync.qfield.projects' },
];

interface QFieldGroupProps {
  activeTab: string | null;
  onTabChange: (tab: string) => void;
}

export function QFieldGroup({ activeTab, onTabChange }: QFieldGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter(tab => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  const currentTab = useMemo(() => {
    const requested = activeTab as QFieldTabId;
    if (accessibleTabs.some(t => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'projects';
  }, [activeTab, accessibleTabs]);

  // Set default tab on mount
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
          You don&apos;t have permission to access QField tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="QField Tabs">
          {accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {currentTab === 'projects' && <QFieldProjectsTab />}
    </div>
  );
}
