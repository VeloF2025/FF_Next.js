'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { NavSection } from '../types';

const STORAGE_KEY = 'ff-sidebar-expanded-sections';

interface UseSectionCollapseOptions {
  sections: NavSection[];
}

interface UseSectionCollapseReturn {
  expandedSections: Set<string>;
  toggleSection: (sectionId: string, shiftKey?: boolean) => void;
  isSectionExpanded: (sectionId: string) => boolean;
}

/**
 * Hook to manage collapsible sidebar sections
 *
 * Behaviors:
 * - Click: Expand clicked section, collapse others
 * - Shift+click: Toggle section without affecting others
 * - Current route's section auto-expands on page load
 * - State persists in localStorage
 */
export function useSectionCollapse({ sections }: UseSectionCollapseOptions): UseSectionCollapseReturn {
  const pathname = usePathname();

  // Initialize with defaultExpanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    // Start with sections marked as defaultExpanded
    const initial = new Set<string>();
    sections.forEach(section => {
      if (section.defaultExpanded) {
        initial.add(section.sectionId);
      }
    });
    return initial;
  });

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setExpandedSections(new Set(parsed));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save to localStorage when expanded sections change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expandedSections]));
    } catch {
      // Ignore localStorage errors
    }
  }, [expandedSections]);

  // Auto-expand section containing current route
  useEffect(() => {
    const activeSectionId = findSectionByPath(sections, pathname);
    if (activeSectionId && !expandedSections.has(activeSectionId)) {
      setExpandedSections(prev => new Set([...prev, activeSectionId]));
    }
  }, [pathname, sections, expandedSections]);

  const toggleSection = useCallback((sectionId: string, shiftKey = false) => {
    setExpandedSections(prev => {
      const next = new Set(prev);

      if (shiftKey) {
        // Shift+click: Toggle without affecting others
        if (next.has(sectionId)) {
          next.delete(sectionId);
        } else {
          next.add(sectionId);
        }
      } else {
        // Normal click: Expand this, collapse others (except defaultExpanded)
        if (next.has(sectionId)) {
          // Clicking already-expanded section collapses it
          next.delete(sectionId);
        } else {
          // Clear all non-default sections, then add this one
          next.clear();
          sections.forEach(s => {
            if (s.defaultExpanded) {
              next.add(s.sectionId);
            }
          });
          next.add(sectionId);
        }
      }

      return next;
    });
  }, [sections]);

  const isSectionExpanded = useCallback((sectionId: string) => {
    return expandedSections.has(sectionId);
  }, [expandedSections]);

  return {
    expandedSections,
    toggleSection,
    isSectionExpanded,
  };
}

/**
 * Find the section that contains a route matching the given path
 */
function findSectionByPath(sections: NavSection[], pathname: string | null): string | null {
  // Guard against null pathname (can happen during SSR)
  if (!pathname) return null;

  for (const section of sections) {
    for (const item of section.items) {
      if (!item.to) continue; // Skip items without a path
      if (pathname === item.to || pathname.startsWith(item.to + '/')) {
        return section.sectionId;
      }
    }
  }
  return null;
}
