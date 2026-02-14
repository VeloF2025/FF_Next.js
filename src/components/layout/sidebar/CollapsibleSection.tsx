'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SidebarStyles } from './types';
import type { ThemeConfig } from '@/types/theme.types';

interface CollapsibleSectionProps {
  sectionTitle: string;
  sectionId: string;
  isExpanded: boolean;
  isCollapsible: boolean;
  onToggle: (sectionId: string, shiftKey: boolean) => void;
  isCollapsed: boolean; // sidebar collapse (icons-only mode)
  sidebarStyles: SidebarStyles;
  themeConfig: ThemeConfig;
  hasActiveItem: boolean;
  children: React.ReactNode;
  sectionLink?: string; // If provided, section header becomes a direct link
  sectionIcon?: React.ComponentType<{ className?: string }>; // Icon for linked sections
}

export function CollapsibleSection({
  sectionTitle,
  sectionId,
  isExpanded,
  isCollapsible,
  onToggle,
  isCollapsed,
  sidebarStyles,
  themeConfig,
  hasActiveItem,
  children,
  sectionLink,
  sectionIcon: SectionIcon,
}: CollapsibleSectionProps) {
  const pathname = usePathname();

  const handleClick = (e: React.MouseEvent) => {
    if (isCollapsible) {
      onToggle(sectionId, e.shiftKey);
    }
  };

  // In collapsed sidebar mode (icons-only), always show items
  const showContent = isCollapsed || isExpanded || !isCollapsible;

  // Check if this linked section is active
  const isLinkActive = sectionLink && pathname?.startsWith(sectionLink);

  // If sectionLink is provided, render as a direct navigation link (no children/dropdown)
  if (sectionLink) {
    return (
      <div className={`${isCollapsed ? 'px-2' : 'px-4'} mb-4`}>
        <Link
          href={sectionLink}
          className={`w-full flex items-center gap-3 text-sm font-medium px-3 py-2.5 rounded-lg transition-colors ${
            isLinkActive
              ? 'bg-white dark:bg-gray-800/10 text-white'
              : 'hover:bg-white dark:bg-gray-800/5 text-gray-300 hover:text-white'
          }`}
          style={{
            color: isLinkActive ? themeConfig.colors.primary[400] : sidebarStyles.textColor,
            backgroundColor: isLinkActive ? `${themeConfig.colors.primary[500]}20` : undefined
          }}
        >
          {SectionIcon && <SectionIcon className="w-5 h-5 flex-shrink-0" />}
          {!isCollapsed && <span>{sectionTitle}</span>}
        </Link>
      </div>
    );
  }

  return (
    <div className={`${isCollapsed ? 'px-2' : 'px-4'} mb-4`}>
      {/* Section Header */}
      {!isCollapsed && (
        <button
          type="button"
          onClick={handleClick}
          className={`w-full flex items-center justify-between text-xs font-semibold tracking-wide mb-2 px-2 py-1 rounded transition-colors ${
            isCollapsible ? 'hover:bg-white dark:bg-gray-800/5 cursor-pointer' : 'cursor-default'
          }`}
          style={{ color: hasActiveItem ? themeConfig.colors.primary[400] : sidebarStyles.textColorTertiary }}
          title={isCollapsible ? (isExpanded ? 'Click to collapse, Shift+click to keep others open' : 'Click to expand') : undefined}
        >
          <span>{sectionTitle}</span>
          {isCollapsible && (
            <span className="transition-transform duration-200">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
          )}
        </button>
      )}

      {/* Section Content with animation */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          showContent ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-1">
          {children}
        </div>
      </div>
    </div>
  );
}
