'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import type { NavSection, SidebarStyles } from './types';
import type { ThemeConfig } from '@/types/theme.types';
import { CollapsibleSection } from './CollapsibleSection';
import { useSectionCollapse } from './hooks/useSectionCollapse';

interface NavigationMenuProps {
  visibleNavItems: NavSection[];
  isCollapsed: boolean;
  sidebarStyles: SidebarStyles;
  themeConfig: ThemeConfig;
}

export function NavigationMenu({ visibleNavItems, isCollapsed, sidebarStyles, themeConfig }: NavigationMenuProps) {
  const pathname = usePathname();
  const { toggleSection, isSectionExpanded } = useSectionCollapse({ sections: visibleNavItems });
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevPathnameRef = useRef<string | null>(null);

  // Set ref for a section
  const setSectionRef = useCallback((sectionId: string, el: HTMLDivElement | null) => {
    sectionRefs.current[sectionId] = el;
  }, []);

  // Find active section for scrolling
  const activeSectionId = useMemo(() => {
    if (!pathname) return null;
    for (const section of visibleNavItems) {
      for (const item of section.items) {
        if (!item.to) continue;
        if (pathname === item.to || pathname.startsWith(item.to + '/')) {
          return section.sectionId;
        }
      }
    }
    return null;
  }, [pathname, visibleNavItems]);

  // Scroll to active section when pathname changes - center it in the sidebar
  useEffect(() => {
    if (pathname !== prevPathnameRef.current && activeSectionId) {
      prevPathnameRef.current = pathname;
      // Small delay to allow section to expand first
      const timer = setTimeout(() => {
        const el = sectionRefs.current[activeSectionId];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [pathname, activeSectionId]);

  // Compute the active path for each section (most specific match wins)
  // This prevents parent routes (e.g., /ticketing) from being highlighted
  // when a child route (e.g., /ticketing/import) is active
  const activePathBySection = useMemo(() => {
    const result: Record<string, string | null> = {};

    // Guard against null pathname (can happen during SSR)
    if (!pathname) {
      for (const section of visibleNavItems) {
        result[section.sectionId] = null;
      }
      return result;
    }

    for (const section of visibleNavItems) {
      let bestMatch: string | null = null;
      let bestMatchLength = 0;

      for (const item of section.items) {
        if (!item.to) continue; // Skip items without a path
        if (pathname === item.to || pathname.startsWith(item.to + '/')) {
          // Prefer longer (more specific) matches
          if (item.to.length > bestMatchLength) {
            bestMatch = item.to;
            bestMatchLength = item.to.length;
          }
        }
      }
      result[section.sectionId] = bestMatch;
    }

    return result;
  }, [pathname, visibleNavItems]);

  // Check if a section has an active item
  const sectionHasActiveItem = (section: NavSection): boolean => {
    return activePathBySection[section.sectionId] !== null;
  };

  return (
    <>
      {visibleNavItems.map((section) => {
        const activeItemPath = activePathBySection[section.sectionId];

        return (
          <div key={section.sectionId} ref={(el) => setSectionRef(section.sectionId, el)}>
            <CollapsibleSection
              sectionTitle={section.section}
              sectionId={section.sectionId}
              isExpanded={isSectionExpanded(section.sectionId)}
              isCollapsible={section.isCollapsible ?? true}
              onToggle={toggleSection}
              isCollapsed={isCollapsed}
              sidebarStyles={sidebarStyles}
              themeConfig={themeConfig}
              hasActiveItem={sectionHasActiveItem(section)}
            >
            {section.items.map((item) => {
              // Only highlight the most specific match, not parent routes
              const isActive = item.to === activeItemPath;
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  className={`flex items-center rounded-lg transition-all duration-200 relative group ${
                    isCollapsed ? 'px-3 py-3 justify-center' : 'px-3 py-2 space-x-3'
                  }`}
                  style={{
                    backgroundColor: isActive
                      ? themeConfig.colors.primary[500]
                      : 'transparent',
                    color: isActive
                      ? '#ffffff'
                      : sidebarStyles.textColorSecondary
                  }}
                  title={isCollapsed ? item.label : undefined}
                  onMouseEnter={(e) => {
                    const navLink = e.currentTarget;
                    if (!isActive) {
                      navLink.style.backgroundColor = themeConfig.colors.surface.sidebarSecondary || themeConfig.colors.surface.secondary;
                      navLink.style.color = sidebarStyles.textColor;
                    }
                  }}
                  onMouseLeave={(e) => {
                    const navLink = e.currentTarget;
                    if (!isActive) {
                      navLink.style.backgroundColor = 'transparent';
                      navLink.style.color = sidebarStyles.textColorSecondary;
                    }
                  }}
                >
                  <item.icon className={`${isCollapsed ? 'w-5 h-5' : 'w-5 h-5'} flex-shrink-0`} />
                  {!isCollapsed && (
                    <span className="text-sm font-medium truncate">{item.label}</span>
                  )}

                  {/* Tooltip for collapsed sidebar */}
                  {isCollapsed && (
                    <div
                      className="absolute left-full ml-2 px-2 py-1 text-sm rounded-md shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap"
                      style={{
                        backgroundColor: themeConfig.colors.surface.elevated,
                        color: themeConfig.colors.text.primary,
                        borderColor: themeConfig.colors.border.primary
                      }}
                    >
                      {item.label}
                    </div>
                  )}
                </Link>
              );
            })}
            </CollapsibleSection>
          </div>
        );
      })}
    </>
  );
}
