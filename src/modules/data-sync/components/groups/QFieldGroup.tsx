/**
 * QField Group - Manages QFieldCloud projects as import targets
 * Tab: Projects (CRUD for QField project registry)
 */

'use client';

import React, { useEffect } from 'react';
import { MapPin } from 'lucide-react';
import type { QFieldTabId } from '../../types';
import { QFieldProjectsTab } from './qfield/QFieldProjectsTab';

const TABS: { id: QFieldTabId; label: string; icon: React.ElementType }[] = [
  { id: 'projects', label: 'Projects', icon: MapPin },
];

interface QFieldGroupProps {
  activeTab: string | null;
  onTabChange: (tab: string) => void;
}

export function QFieldGroup({ activeTab, onTabChange }: QFieldGroupProps) {
  const currentTab = (activeTab as QFieldTabId) || 'projects';

  // Set default tab on mount
  useEffect(() => {
    if (!activeTab) {
      onTabChange('projects');
    }
  }, [activeTab, onTabChange]);

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="QField Tabs">
          {TABS.map((tab) => {
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
