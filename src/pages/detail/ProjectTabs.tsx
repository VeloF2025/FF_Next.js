/**
 * Project Tabs Component
 * Tab navigation for different project views
 */

import { getTabConfig } from './ProjectDetailUtils';

type TabId = 'overview' | 'hierarchy' | 'sow' | 'timeline' | 'budget';

interface ProjectTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function ProjectTabs({ activeTab, onTabChange }: ProjectTabsProps) {
  const tabs = getTabConfig();

  return (
    <div className="border-b border-[var(--ff-border-light)]">
      <nav className="-mb-px flex space-x-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id as TabId)}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}