'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { NavItem } from '../types';

const STORAGE_KEY = 'ff-sidebar-expanded-groups';

interface UseGroupCollapseOptions {
  items: NavItem[];
  sectionId: string;
}

interface UseGroupCollapseReturn {
  expandedGroups: Set<string>;
  toggleGroup: (groupLabel: string, shiftKey?: boolean) => void;
  isGroupExpanded: (groupLabel: string) => boolean;
}

/**
 * Hook to manage collapsible groups within a sidebar section
 *
 * Behaviors:
 * - Click: Toggle group expand/collapse
 * - Current route's group auto-expands on page load
 * - State persists in localStorage
 */
export function useGroupCollapse({ items, sectionId }: UseGroupCollapseOptions): UseGroupCollapseReturn {
  const pathname = usePathname();
  const initializedRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Initialize with all groups expanded by default
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    // Try to load from localStorage first
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          const sectionGroups = parsed.filter(g => g.startsWith(`${sectionId}:`));
          if (sectionGroups.length > 0) {
            return new Set(sectionGroups);
          }
        }
      } catch {
        // intentional: localStorage may be unavailable (private browsing, quota exceeded)
      }
    }
    // Default: expand all groups
    const initial = new Set<string>();
    items.forEach(item => {
      if (item.isGroup && item.subItems) {
        initial.add(`${sectionId}:${item.label}`);
      }
    });
    return initial;
  });

  // Save to localStorage when expanded groups change (debounced)
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        let allGroups: string[] = [];
        if (stored) {
          allGroups = JSON.parse(stored) as string[];
          allGroups = allGroups.filter(g => !g.startsWith(`${sectionId}:`));
        }
        allGroups.push(...Array.from(expandedGroups));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allGroups));
      } catch {
        // intentional: localStorage may be unavailable (private browsing, quota exceeded)
      }
    }, 100);

    return () => clearTimeout(timeout);
  }, [expandedGroups, sectionId]);

  // Auto-expand group containing current route (only on pathname change)
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = pathname;

    const currentItems = itemsRef.current;
    for (const item of currentItems) {
      if (item.isGroup && item.subItems) {
        for (const subItem of item.subItems) {
          if (subItem.to && (pathname === subItem.to || pathname.startsWith(subItem.to + '/'))) {
            const groupKey = `${sectionId}:${item.label}`;
            setExpandedGroups(prev => {
              if (prev.has(groupKey)) return prev;
              const next = new Set(prev);
              next.add(groupKey);
              return next;
            });
            return;
          }
        }
      }
    }
  }, [pathname, sectionId]);

  const toggleGroup = useCallback((groupLabel: string) => {
    const groupKey = `${sectionId}:${groupLabel}`;
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, [sectionId]);

  const isGroupExpanded = useCallback((groupLabel: string) => {
    return expandedGroups.has(`${sectionId}:${groupLabel}`);
  }, [expandedGroups, sectionId]);

  return {
    expandedGroups,
    toggleGroup,
    isGroupExpanded,
  };
}
