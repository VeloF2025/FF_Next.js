/**
 * Project Tabs Component
 * Tab navigation for different project views with grouped hierarchy
 * Sprint 1: Added Team, Procurement, Maintenance tabs
 * Updated: Now uses grouped tabs (Work, Contracts, Planning, Operations, Finance)
 */

import { useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types/auth.types';
import { getGroupedTabConfig, TabGroup } from './ProjectDetailUtils';

export type TabId = 'overview' | 'team' | 'procurement' | 'maintenance' | 'hierarchy' | 'sow' | 'boq' | 'agreements' | 'wayleaves' | 'timeline' | 'budget' | 'hs' | 'finance-dashboard' | 'income' | 'documents' | 'pon-stages' | 'pon-progress' | 'prereqs' | 'sp-tracker' | 'site-visits';

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
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole(UserRole.SUPER_ADMIN);

  const groups = useMemo(() => {
    const all = getGroupedTabConfig();
    return isSuperAdmin ? all : all.filter((g) => g.id !== 'finance');
  }, [isSuperAdmin]);

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

  // Generate grid columns class based on number of tabs
  const gridColsClass = `grid-cols-${groups.length}`;

  // Arrow key navigation for primary tabs
  const handlePrimaryTabKeyDown = useCallback(
    (e: React.KeyboardEvent, currentGroupId: string) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const currentIndex = groups.findIndex(g => g.id === currentGroupId);
        let nextIndex = currentIndex;
        if (e.key === 'ArrowLeft') {
          nextIndex = currentIndex === 0 ? groups.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex === groups.length - 1 ? 0 : currentIndex + 1;
        }
        const nextGroup = groups[nextIndex];
        if (nextGroup?.tabs[0]) {
          onTabChange(nextGroup.tabs[0].id as TabId);
        }
      }
    },
    [groups, onTabChange]
  );

  // Arrow key navigation for sub-tabs
  const handleSubTabKeyDown = useCallback(
    (e: React.KeyboardEvent, currentTabId: string) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (!activeGroup) return;
        const currentIndex = activeGroup.tabs.findIndex(t => t.id === currentTabId);
        let nextIndex = currentIndex;
        if (e.key === 'ArrowLeft') {
          nextIndex = currentIndex === 0 ? activeGroup.tabs.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex === activeGroup.tabs.length - 1 ? 0 : currentIndex + 1;
        }
        const nextTab = activeGroup.tabs[nextIndex];
        if (nextTab) {
          onTabChange(nextTab.id as TabId);
        }
      }
    },
    [activeGroup, onTabChange]
  );

  return (
    <div className="space-y-0">
      {/* Primary Group Tabs - using grid for guaranteed equal width */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav
          role="tablist"
          className="-mb-px grid w-full"
          style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }}
        >
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
                role="tab"
                aria-selected={isActive}
                aria-controls={`${group.id}-panel`}
                onClick={() => {
                  // Navigate to first tab in group
                  const firstTab = group.tabs[0];
                  if (firstTab) {
                    onTabChange(firstTab.id as TabId);
                  }
                }}
                onKeyDown={(e) => handlePrimaryTabKeyDown(e, group.id)}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 ${
                  isActive
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                }`}
              >
                {group.label}
                {groupBadgeCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400" aria-hidden="true">
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
        <div id={`${activeGroupId}-panel`} className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
          <nav
            role="tablist"
            className="grid w-full py-1 gap-1"
            style={{ gridTemplateColumns: `repeat(${activeGroup.tabs.length}, 1fr)` }}
          >
            {activeGroup.tabs.map((tab) => {
              const badgeCount = badges[tab.id];
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`${tab.id}-panel`}
                  onClick={() => onTabChange(tab.id as TabId)}
                  onKeyDown={(e) => handleSubTabKeyDown(e, tab.id)}
                  className={`py-1.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-0 ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                  }`}
                >
                  {tab.label}
                  {badgeCount !== undefined && badgeCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400" aria-hidden="true">
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