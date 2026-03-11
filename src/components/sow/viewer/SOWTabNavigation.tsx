/**
 * SOW Data Viewer Tab Navigation
 */

import { cn } from '@/utils/cn';
import { TabConfig, TabType } from './SOWViewerTypes';

interface SOWTabNavigationProps {
  tabs: TabConfig[];
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export function SOWTabNavigation({ tabs, activeTab, onTabChange }: SOWTabNavigationProps) {
  return (
    <div className="border-b border-[var(--ff-border-primary)]">
      <nav className="flex gap-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-1 py-3 border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="font-medium">{tab.label}</span>
              {tab.count !== null && (
                <span className={cn(
                  "ml-2 px-2 py-0.5 text-xs rounded-full",
                  activeTab === tab.id
                    ? "bg-primary-100 text-primary-700"
                    : "bg-[var(--ff-surface-secondary)] text-[var(--ff-text-tertiary)]"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}