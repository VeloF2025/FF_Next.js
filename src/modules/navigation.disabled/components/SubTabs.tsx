/**
 * SubTabs Component
 * Secondary tab row for 3rd level navigation
 * Uses FibreFlow Design System CSS variables
 */

'use client';

import React from 'react';
import Link from 'next/link';
import type { TabConfig } from '../types';

interface SubTabsProps {
  /** Sub-tab configurations to render */
  subTabs: TabConfig[];
  /** Currently active sub-tab ID */
  activeSubTab: string | null;
  /** Loading state */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Called when sub-tab changes */
  onSubTabChange?: (subTabId: string) => void;
}

export function SubTabs({
  subTabs,
  activeSubTab,
  isLoading = false,
  className = '',
  onSubTabChange,
}: SubTabsProps) {
  if (!subTabs || subTabs.length === 0) return null;

  const handleClick = (subTab: TabConfig, e: React.MouseEvent) => {
    if (isLoading) {
      e.preventDefault();
      return;
    }

    if (onSubTabChange) {
      onSubTabChange(subTab.id);
    }
  };

  return (
    <nav
      className={`flex space-x-1 bg-[var(--ff-bg-tertiary)] rounded-lg p-1 ${className}`}
      aria-label="Sub-tabs"
    >
      {subTabs.map((subTab) => {
        const Icon = subTab.icon;
        const isActive = activeSubTab === subTab.id;

        return (
          <Link
            key={subTab.id}
            href={isLoading ? '#' : subTab.path}
            onClick={(e) => handleClick(subTab, e)}
            className={`
              inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium
              transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-primary-500)]
              ${isActive
                ? 'bg-[var(--ff-bg-card)] text-[var(--ff-text-primary)] shadow-sm'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
              }
              ${isLoading ? 'opacity-50 cursor-wait pointer-events-none' : ''}
            `}
            aria-current={isActive ? 'page' : undefined}
          >
            {Icon && <Icon className="h-4 w-4 mr-2 flex-shrink-0" />}
            {subTab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default SubTabs;
