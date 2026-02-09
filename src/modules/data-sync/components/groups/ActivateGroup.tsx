/**
 * Activate Group Component
 * Wraps activate import tabs: OES Import, ARCH Import, Manual Entry
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { FileSpreadsheet, WifiOff, PlusCircle, Loader2, Lock } from 'lucide-react';
import type { ActivateTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

// Import existing activate components
import { OESImportTab } from '@/modules/activate/components/OESImportTab';
import { OfflineImportTab } from '@/modules/activate/components/OfflineImportTab';
import { ManualDREntry } from '@/modules/activate/components/ManualDREntry';

// Tab configuration with permission keys
const TABS: { id: ActivateTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'oes', label: 'OES Import', icon: FileSpreadsheet, permissionKey: 'system.data-sync.activate.oes' },
  { id: 'arch', label: 'ARCH Import', icon: WifiOff, permissionKey: 'system.data-sync.activate.arch' },
  { id: 'manual', label: 'Manual Entry', icon: PlusCircle, permissionKey: 'system.data-sync.activate.manual' },
];

interface ActivateGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function ActivateGroup({ activeTab, onTabChange }: ActivateGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter(tab => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  // Default to first accessible tab
  const currentTab = useMemo(() => {
    const requested = activeTab as ActivateTabId;
    if (accessibleTabs.some(t => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'oes';
  }, [activeTab, accessibleTabs]);

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab && accessibleTabs.length > 0) {
      onTabChange(accessibleTabs[0].id);
    }
  }, [activeTab, onTabChange, accessibleTabs]);

  // Callback for when an import completes (optional refresh trigger)
  const handleImportComplete = () => {
    // Could trigger a refresh or show notification
    // For now, components handle their own success states
  };

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
          You don&apos;t have permission to access any Activate tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Activate Tabs">
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
      {currentTab === 'oes' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              OES Activation Import
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Import Nokia OES activation reports to reconcile drops with actual activations
            </p>
          </div>
          <OESImportTab onImportComplete={handleImportComplete} />
        </div>
      )}

      {currentTab === 'arch' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              ARCH Offline Import
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Import ARCH network audit reports to detect offline devices and serial mismatches
            </p>
          </div>
          <OfflineImportTab onImportComplete={handleImportComplete} />
        </div>
      )}

      {currentTab === 'manual' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Manual DR Entry</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Add DRs manually when WhatsApp bridge is down or for special processing
            </p>
          </div>
          <ManualDREntry />
        </div>
      )}
    </div>
  );
}
