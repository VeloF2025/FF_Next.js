/**
 * ModuleTabs Component
 * Horizontal tab navigation bar for module pages
 * Uses FibreFlow Design System CSS variables
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import type { TabConfig, TabBadge } from '../types';

interface ModuleTabsProps {
  /** Tab configurations to render */
  tabs: TabConfig[];
  /** Currently active tab ID */
  activeTab: string | null;
  /** Tab badges (overrides static config badges) */
  tabBadges?: Record<string, TabBadge>;
  /** Permission check function */
  hasPermission?: (rbacKey?: string) => boolean;
  /** Loading state - disables interaction */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Called when tab changes (for controlled mode) */
  onTabChange?: (tabId: string) => void;
}

export function ModuleTabs({
  tabs,
  activeTab,
  tabBadges = {},
  hasPermission = () => true,
  isLoading = false,
  className = '',
  onTabChange,
}: ModuleTabsProps) {
  const router = useRouter();

  // Filter out hidden tabs
  const visibleTabs = tabs.filter((tab) => !tab.hidden);

  if (visibleTabs.length === 0) return null;

  const handleTabClick = (tab: TabConfig, e: React.MouseEvent) => {
    const canAccess = hasPermission(tab.rbacKey);

    if (!canAccess || isLoading) {
      e.preventDefault();
      return;
    }

    if (onTabChange) {
      onTabChange(tab.id);
    }

    // Let Link handle navigation unless external
    if (tab.external) {
      e.preventDefault();
      window.open(tab.path, '_blank');
    }
  };

  return (
    <nav
      className={`flex space-x-1 overflow-x-auto scrollbar-hide ${className}`}
      aria-label="Module tabs"
    >
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const canAccess = hasPermission(tab.rbacKey);
        const badge = tabBadges[tab.id] ?? tab.badge;

        return (
          <Link
            key={tab.id}
            href={canAccess && !isLoading ? tab.path : '#'}
            onClick={(e) => handleTabClick(tab, e)}
            className={`
              relative py-3 px-4 border-b-2 font-medium text-sm whitespace-nowrap
              flex items-center gap-2 transition-all duration-200 min-w-fit
              ${isActive
                ? 'border-[var(--ff-primary-500)] text-[var(--ff-primary-500)] bg-[var(--ff-primary-500)]/10'
                : !canAccess
                ? 'border-transparent text-[var(--ff-text-tertiary)] cursor-not-allowed opacity-60'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }
              ${isLoading ? 'opacity-50 cursor-wait pointer-events-none' : ''}
            `}
            aria-current={isActive ? 'page' : undefined}
            aria-disabled={!canAccess || isLoading}
          >
            {/* Icon */}
            <div className="flex items-center gap-1">
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!canAccess && (
                <Lock className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
              )}
            </div>

            {/* Label */}
            <span className="truncate">{tab.label}</span>

            {/* Badge */}
            {badge && badge.count !== undefined && badge.count > 0 && (
              <TabBadgeDisplay badge={badge} />
            )}

            {/* Active indicator animation */}
            {isActive && isLoading && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--ff-primary-500)] animate-pulse" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Tab badge display component
 */
function TabBadgeDisplay({ badge }: { badge: TabBadge }) {
  const typeStyles: Record<NonNullable<TabBadge['type']>, string> = {
    error: 'bg-[var(--ff-error)]/20 text-[var(--ff-error)]',
    warning: 'bg-[var(--ff-warning)]/20 text-[var(--ff-warning)]',
    success: 'bg-[var(--ff-success)]/20 text-[var(--ff-success)]',
    info: 'bg-[var(--ff-info)]/20 text-[var(--ff-info)]',
  };

  const displayCount = (badge.count ?? 0) > 99 ? '99+' : badge.count;

  return (
    <span
      className={`
        ml-1 px-2 py-0.5 text-xs font-medium rounded-full min-w-[1.5rem] text-center
        ${typeStyles[badge.type ?? 'info']}
        ${badge.pulse ? 'animate-pulse' : ''}
      `}
    >
      {displayCount}
    </span>
  );
}

export default ModuleTabs;
