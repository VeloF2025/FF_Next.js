/**
 * Project Tabs Component
 * Tab navigation for different project views
 * Sprint 1: Added Team, Procurement, Maintenance tabs
 */

import { getTabConfig } from './ProjectDetailUtils';

export type TabId = 'overview' | 'team' | 'procurement' | 'maintenance' | 'hierarchy' | 'sow' | 'timeline' | 'budget' | 'hs';

interface ProjectTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  badges?: Record<string, number>;
}

export function ProjectTabs({ activeTab, onTabChange, badges = {} }: ProjectTabsProps) {
  const tabs = getTabConfig();

  return (
    <div className="border-b border-[var(--ff-border-light)]">
      <nav className="-mb-px flex space-x-6 overflow-x-auto">
        {tabs.map((tab) => {
          const badgeCount = badges[tab.id];
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id as TabId)}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              {tab.label}
              {badgeCount !== undefined && badgeCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}