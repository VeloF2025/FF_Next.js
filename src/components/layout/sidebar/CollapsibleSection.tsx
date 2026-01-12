'use client';

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
}: CollapsibleSectionProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (isCollapsible) {
      onToggle(sectionId, e.shiftKey);
    }
  };

  // In collapsed sidebar mode (icons-only), always show items
  const showContent = isCollapsed || isExpanded || !isCollapsible;

  return (
    <div className={`${isCollapsed ? 'px-2' : 'px-4'} mb-4`}>
      {/* Section Header */}
      {!isCollapsed && (
        <button
          type="button"
          onClick={handleClick}
          className={`w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-2 px-2 py-1 rounded transition-colors ${
            isCollapsible ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'
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
