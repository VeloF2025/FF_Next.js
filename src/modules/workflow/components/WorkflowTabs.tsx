// 🟢 WORKING: Workflow portal tab navigation component
import React from 'react';
import { FileText, Edit3, Layers, BarChart3 } from 'lucide-react';
import type { WorkflowTabId, WorkflowTabBadge } from '../types/portal.types';

interface WorkflowTab {
  id: WorkflowTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

interface WorkflowTabsProps {
  activeTab: WorkflowTabId;
  onTabChange: (tabId: WorkflowTabId) => void;
  tabBadges?: Record<WorkflowTabId, WorkflowTabBadge>;
  isLoading?: boolean;
}

const tabs: WorkflowTab[] = [
  {
    id: 'templates',
    label: 'Templates',
    icon: FileText,
    description: 'View and manage workflow templates'
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: Edit3,
    description: 'Create and edit workflow templates'
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: Layers,
    description: 'Manage project workflow assignments'
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    description: 'View workflow performance metrics'
  }
];

export function WorkflowTabs({ 
  activeTab, 
  onTabChange, 
  tabBadges = {
    templates: {},
    editor: {},
    projects: {},
    analytics: {}
  },
  isLoading = false 
}: WorkflowTabsProps) {
  const renderBadge = (badge?: WorkflowTabBadge) => {
    if (!badge || (badge.count === undefined && !badge.type)) return null;

    const badgeClasses = {
      info: 'bg-blue-500/20 text-blue-400',
      warning: 'bg-yellow-500/20 text-yellow-400',
      error: 'bg-red-500/20 text-red-400',
      success: 'bg-green-500/20 text-green-400'
    };

    const className = badge.type ? badgeClasses[badge.type] : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';

    return (
      <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
        {badge.count !== undefined ? badge.count : ''}
      </span>
    );
  };

  return (
    <div className="border-b border-[var(--ff-border-light)]">
      <nav className="-mb-px flex space-x-8" aria-label="Workflow tabs">
        {tabs.map((tab) => {
          const IconComponent = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = tabBadges[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => !isLoading && onTabChange(tab.id)}
              disabled={isLoading}
              className={`group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-all duration-200 ${
                isActive
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              } ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              aria-current={isActive ? 'page' : undefined}
              title={tab.description}
            >
              <IconComponent
                className={`mr-2 h-5 w-5 transition-colors ${
                  isActive
                    ? 'text-blue-500'
                    : 'text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-text-secondary)]'
                }`}
                aria-hidden="true"
              />
              <span>{tab.label}</span>
              {renderBadge(badge)}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// 🟢 WORKING: Workflow tabs with dark mode support using CSS variables