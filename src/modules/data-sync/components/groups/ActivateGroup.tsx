/**
 * Activate Group Component
 * Wraps activate import tabs: OES Import, ARCH Import, Manual Entry
 */

'use client';

import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, WifiOff, PlusCircle } from 'lucide-react';
import type { ActivateTabId } from '../../types';

// Import existing activate components
import { OESImportTab } from '@/modules/activate/components/OESImportTab';
import { OfflineImportTab } from '@/modules/activate/components/OfflineImportTab';
import { ManualDREntry } from '@/modules/activate/components/ManualDREntry';

// Tab configuration
const TABS: { id: ActivateTabId; label: string; icon: React.ElementType }[] = [
  { id: 'oes', label: 'OES Import', icon: FileSpreadsheet },
  { id: 'arch', label: 'ARCH Import', icon: WifiOff },
  { id: 'manual', label: 'Manual Entry', icon: PlusCircle },
];

interface ActivateGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function ActivateGroup({ activeTab, onTabChange }: ActivateGroupProps) {
  // Default to first tab if none specified
  const currentTab = (activeTab as ActivateTabId) || 'oes';

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab) {
      onTabChange('oes');
    }
  }, [activeTab, onTabChange]);

  // Callback for when an import completes (optional refresh trigger)
  const handleImportComplete = () => {
    // Could trigger a refresh or show notification
    // For now, components handle their own success states
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="Activate Tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
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
