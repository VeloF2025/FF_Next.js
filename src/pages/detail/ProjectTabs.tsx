/**
 * Project Tabs Component
 * Tab navigation for different project views with grouped hierarchy
 * Sprint 1: Added Team, Procurement, Maintenance tabs
 * Updated: Now uses grouped tabs (Work, Contracts, Planning, Operations, Finance)
 */

import { useMemo } from 'react';
import { getGroupedTabConfig, TabGroup } from './ProjectDetailUtils';

export type TabId = 'overview' | 'team' | 'procurement' | 'maintenance' | 'hierarchy' | 'sow' | 'boq' | 'agreements' | 'wayleaves' | 'timeline' | 'budget' | 'hs' | 'finance-dashboard' | 'income' | 'documents';

interface ProjectTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  badges?: Record<string, number>;
}

/**
 * Find which group contains a tab
 */
function findGroupForTab(groups: TabGroup[], tabId: string): string | null {
  for (const group of groups) {
    if (group.tabs.some(t => t.id === tabId)) {
      return group.id;
    }
  }
  return null;
}

export function ProjectTabs({ activeTab, onTabChange, badges = {} }: ProjectTabsProps) {
  const groups = useMemo(() => getGroupedTabConfig(), []);

  // Determine which group is active based on the active tab
  const activeGroupId = useMemo(
    () => findGroupForTab(groups, activeTab) || 'overview',
    [groups, activeTab]
  );

  // Get the active group's sub-tabs
  const activeGroup = useMemo(
    () => groups.find(g => g.id === activeGroupId),
    [groups, activeGroupId]
  );

  return (
    <div className="space-y-0">
      {/* Primary Group Tabs */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="-mb-px flex w-full overflow-x-auto">
          {groups.map((group) => {
            const isActive = activeGroupId === group.id;
            // Show badge count for group (sum of all tab badges in group)
            const groupBadgeCount = group.tabs.reduce(
              (sum, tab) => sum + (badges[tab.id] || 0),
              0
            );

            return (
              <button
                key={group.id}
                onClick={() => {
                  // Navigate to first tab in group
                  const firstTab = group.tabs[0];
                  if (firstTab) {
                    onTabChange(firstTab.id as TabId);
                  }
                }}
                className={`flex-1 py-3 px-4 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                  isActive
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                }`}
              >
                {group.label}
                {groupBadgeCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400">
                    {groupBadgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sub-tabs for active group (only show if group has multiple tabs) */}
      {activeGroup && activeGroup.tabs.length > 1 && (
        <div className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-2">
          <nav className="flex w-full overflow-x-auto py-1">
            {activeGroup.tabs.map((tab) => {
              const badgeCount = badges[tab.id];
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id as TabId)}
                  className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
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
      )}
    </div>
  );
}