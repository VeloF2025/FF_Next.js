/**
 * ModuleTabs Component
 * Horizontal tab bar for module navigation
 * Uses FibreFlow Design System CSS variables
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { TabConfig, TabBadge } from '../types';

interface ModuleTabsProps {
  /** Tab configurations */
  tabs: TabConfig[];
  /** Currently active tab ID */
  activeTab: string | null;
  /** Tab badges (keyed by tab ID) */
  tabBadges?: Record<string, TabBadge>;
  /** Permission checker function */
  hasPermission?: (rbacKey: string) => boolean;
  /** Loading state */
  isLoading?: boolean;
  /** Tab change callback (for controlled mode) */
  onTabChange?: (tabId: string) => void;
}

/**
 * Badge component for tabs
 */
function TabBadgeComponent({ badge }: { badge: TabBadge }) {
  const colorMap: Record<TabBadge['type'], string> = {
    info: 'bg-[var(--ff-info)]/20 text-[var(--ff-info)]',
    warning: 'bg-[var(--ff-warning)]/20 text-[var(--ff-warning)]',
    error: 'bg-[var(--ff-error)]/20 text-[var(--ff-error)]',
    success: 'bg-[var(--ff-success)]/20 text-[var(--ff-success)]',
  };

  return (
    <span
      className={`ml-2 px-2 py-0.5 text-xs font-medium rounded-full ${colorMap[badge.type]}`}
    >
      {badge.count > 99 ? '99+' : badge.count}
    </span>
  );
}

export function ModuleTabs({
  tabs,
  activeTab,
  tabBadges = {},
  hasPermission = () => true,
  isLoading = false,
  onTabChange,
}: ModuleTabsProps) {
  return (
    <nav
      className="flex w-full -mb-px"
      aria-label="Module tabs"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isLocked = tab.rbacKey && !hasPermission(tab.rbacKey);
        const badge = tabBadges[tab.id] || tab.badge;
        const Icon = tab.icon;

        // Tab styles - grid handles equal width, we just center content
        const baseStyles =
          'flex items-center justify-center gap-2 py-3 px-4 border-b-2 font-medium text-sm transition-colors';
        const activeStyles =
          'border-[var(--ff-primary-500)] text-[var(--ff-primary-400)] bg-[var(--ff-primary-500)]/10';
        const inactiveStyles =
          'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]';
        const lockedStyles = 'opacity-50 cursor-not-allowed';
        const loadingStyles = isLoading ? 'pointer-events-none opacity-60' : '';

        const tabClassName = `${baseStyles} ${isActive ? activeStyles : inactiveStyles} ${isLocked ? lockedStyles : ''} ${loadingStyles}`;

        const tabContent = (
          <>
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
            {isLocked && <Lock className="h-3 w-3 ml-1 opacity-60" />}
            {badge && !isLocked && <TabBadgeComponent badge={badge} />}
          </>
        );

        if (isLocked) {
          return (
            <button
              key={tab.id}
              type="button"
              className={tabClassName}
              disabled
              title="You don't have permission to access this tab"
            >
              {tabContent}
            </button>
          );
        }

        // Use Link for navigation (URL-based tabs)
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={tabClassName}
            onClick={(e) => {
              if (onTabChange) {
                // If controlled, still navigate but also call callback
                onTabChange(tab.id);
              }
            }}
          >
            {tabContent}
          </Link>
        );
      })}
    </nav>
  );
}

export default ModuleTabs;
