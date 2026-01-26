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
  /** Sub-tab configurations */
  subTabs: TabConfig[];
  /** Currently active sub-tab ID */
  activeSubTab: string | null;
  /** Loading state */
  isLoading?: boolean;
  /** Sub-tab change callback (for controlled mode) */
  onSubTabChange?: (subTabId: string) => void;
}

export function SubTabs({
  subTabs,
  activeSubTab,
  isLoading = false,
  onSubTabChange,
}: SubTabsProps) {
  if (!subTabs.length) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-2">
      {subTabs.map((subTab) => {
        const isActive = activeSubTab === subTab.id;
        const Icon = subTab.icon;

        // Pill-style sub-tabs using CSS variables
        const baseStyles =
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap';
        const activeStyles =
          'bg-[var(--ff-primary-500)] text-white shadow-sm';
        const inactiveStyles =
          'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-card)] hover:text-[var(--ff-text-primary)]';
        const loadingStyles = isLoading ? 'pointer-events-none opacity-60' : '';

        const className = `${baseStyles} ${isActive ? activeStyles : inactiveStyles} ${loadingStyles}`;

        return (
          <Link
            key={subTab.id}
            href={subTab.path}
            className={className}
            onClick={(e) => {
              if (onSubTabChange) {
                onSubTabChange(subTab.id);
              }
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{subTab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default SubTabs;
