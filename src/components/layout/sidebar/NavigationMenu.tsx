'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NavSection, NavItem, SidebarStyles } from './types';
import type { ThemeConfig } from '@/types/theme.types';
import { CollapsibleSection } from './CollapsibleSection';
import { useSectionCollapse } from './hooks/useSectionCollapse';
import { useGroupCollapse } from './hooks/useGroupCollapse';

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
  const prevSectionRef = useRef<string | null>(null);

  // Find procurement section for group collapse (could be generalized for any section with groups)
  const procurementSection = visibleNavItems.find(s => s.sectionId === 'procurement');
  const { toggleGroup, isGroupExpanded } = useGroupCollapse({
    items: procurementSection?.items || [],
    sectionId: 'procurement'
  });

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

  // Scroll to active section ONLY when section changes (not on every pathname change)
  // This prevents the jarring jump when clicking items within the same section
  useEffect(() => {
    if (activeSectionId && activeSectionId !== prevSectionRef.current) {
      prevSectionRef.current = activeSectionId;
      // Small delay to allow section to expand first
      const timer = setTimeout(() => {
        const el = sectionRefs.current[activeSectionId];
        if (el) {
          // Only scroll if the section is not already visible in the viewport
          const rect = el.getBoundingClientRect();
          const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
          if (!isVisible) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeSectionId]);

  // Compute the active path for each section (most specific match wins)
  // This prevents parent routes (e.g., /maintenance) from being highlighted
  // when a child route (e.g., /maintenance/import) is active
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

      const checkItem = (item: NavItem) => {
        if (item.isGroup && item.subItems) {
          // Check subItems for groups
          for (const subItem of item.subItems) {
            checkItem(subItem);
          }
        } else if (item.to) {
          if (pathname === item.to || pathname.startsWith(item.to + '/')) {
            // Prefer longer (more specific) matches
            if (item.to.length > bestMatchLength) {
              bestMatch = item.to;
              bestMatchLength = item.to.length;
            }
          }
        }
      };

      for (const item of section.items) {
        checkItem(item);
      }
      result[section.sectionId] = bestMatch;
    }

    return result;
  }, [pathname, visibleNavItems]);

  // Check if a section has an active item
  const sectionHasActiveItem = (section: NavSection): boolean => {
    return activePathBySection[section.sectionId] !== null;
  };

  // Helper function to render a single nav item
  const renderNavItem = (item: NavItem, isActive: boolean, isSubItem: boolean) => {
    const linkClassName = `flex items-center rounded-lg transition-all duration-200 relative group ${
      isCollapsed ? 'px-3 py-3 justify-center' : isSubItem ? 'px-3 py-2 space-x-3' : 'px-3 py-2 space-x-3'
    }`;
    const linkStyle = {
      backgroundColor: isActive
        ? themeConfig.colors.primary[500]
        : 'transparent',
      color: isActive
        ? '#ffffff'
        : sidebarStyles.textColorSecondary
    };
    const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
      const navLink = e.currentTarget;
      if (!isActive) {
        navLink.style.backgroundColor = themeConfig.colors.surface.sidebarSecondary || themeConfig.colors.surface.secondary;
        navLink.style.color = sidebarStyles.textColor;
      }
    };
    const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
      const navLink = e.currentTarget;
      if (!isActive) {
        navLink.style.backgroundColor = 'transparent';
        navLink.style.color = sidebarStyles.textColorSecondary;
      }
    };

    const linkContent = (
      <>
        <item.icon className={`${isCollapsed ? 'w-5 h-5' : isSubItem ? 'w-4 h-4' : 'w-5 h-5'} flex-shrink-0`} />
        {!isCollapsed && (
          <span className={`${isSubItem ? 'text-sm' : 'text-sm'} font-medium truncate`}>{item.label}</span>
        )}
        {/* External link indicator */}
        {!isCollapsed && item.external && (
          <svg className="w-3 h-3 ml-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
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
            {item.label}{item.external ? ' ↗' : ''}
          </div>
        )}
      </>
    );

    // External links use <a> with target="_blank"
    if (item.external) {
      return (
        <a
          key={item.to}
          href={item.to}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
          style={linkStyle}
          title={isCollapsed ? item.label : undefined}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {linkContent}
        </a>
      );
    }

    // Internal links use Next.js Link
    return (
      <Link
        key={item.to}
        href={item.to}
        className={linkClassName}
        style={linkStyle}
        title={isCollapsed ? item.label : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {linkContent}
      </Link>
    );
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
              sectionLink={section.sectionLink}
              sectionIcon={section.sectionLink ? section.items[0]?.icon : undefined}
            >
            {section.items.map((item) => {
              // Handle group items (collapsible with subItems)
              if (item.isGroup && item.subItems) {
                const groupExpanded = isGroupExpanded(item.label);
                const hasActiveSubItem = item.subItems.some(
                  sub => sub.to === activeItemPath || (sub.to && pathname?.startsWith(sub.to + '/'))
                );

                // In collapsed sidebar mode, don't show groups - show subItems directly
                if (isCollapsed) {
                  return item.subItems.map((subItem) => {
                    const isSubActive = !subItem.external && subItem.to === activeItemPath;
                    return renderNavItem(subItem, isSubActive, false);
                  });
                }

                return (
                  <div key={item.label} className="mb-1">
                    {/* Group Header */}
                    <button
                      type="button"
                      onClick={(e) => toggleGroup(item.label, e.shiftKey)}
                      className="w-full flex items-center rounded-lg transition-all duration-200 px-3 py-2 space-x-3 hover:bg-card/5"
                      style={{
                        color: hasActiveSubItem
                          ? themeConfig.colors.primary[400]
                          : sidebarStyles.textColorSecondary
                      }}
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium truncate flex-1 text-left">{item.label}</span>
                      <span className="transition-transform duration-200">
                        {groupExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                    </button>

                    {/* SubItems */}
                    <div
                      className={`overflow-hidden transition-all duration-200 ease-in-out ${
                        groupExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pl-4 space-y-1 mt-1">
                        {item.subItems.map((subItem) => {
                          const isSubActive = !subItem.external && subItem.to === activeItemPath;
                          return renderNavItem(subItem, isSubActive, true);
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              // Regular item (not a group)
              const isActive = !item.external && item.to === activeItemPath;
              return renderNavItem(item, isActive, false);
            })}

            </CollapsibleSection>
          </div>
        );
      })}
    </>
  );
}
