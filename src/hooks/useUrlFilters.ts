'use client';

/**
 * useUrlFilters — Bidirectional sync between filter state and URL search params.
 *
 * Reads initial values from URL on mount, and pushes changes back to URL
 * without triggering a full navigation (uses replaceState).
 *
 * Usage:
 *   const [filters, setFilter] = useUrlFilters({
 *     status: '',
 *     type: '',
 *     view: 'table',
 *   });
 *
 *   setFilter('status', 'active');  // updates state + URL
 *   setFilter('type', '');          // removes param from URL
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

type FilterValues = Record<string, string>;

/**
 * @param defaults - default values for each filter key. Empty string = no filter.
 * @param options.excludeFromUrl - keys to keep in state but not persist to URL
 */
export function useUrlFilters<T extends FilterValues>(
  defaults: T,
  options?: { excludeFromUrl?: (keyof T)[] }
) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const excludeSet = new Set(options?.excludeFromUrl || []);
  const isInitialized = useRef(false);

  // Build initial state from URL params, falling back to defaults
  const [filters, setFilters] = useState<T>(() => {
    const initial = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const urlVal = searchParams?.get(key);
      if (urlVal !== null && urlVal !== undefined) {
        (initial as FilterValues)[key] = urlVal;
      }
    }
    return initial;
  });

  // Push state to URL (replaceState, no navigation)
  const syncToUrl = useCallback((current: T) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(current)) {
      if (value && value !== defaults[key as keyof T] && !excludeSet.has(key)) {
        params.set(key, value);
      }
    }
    const search = params.toString();
    const url = search ? `${pathname}?${search}` : pathname || '/';
    window.history.replaceState(null, '', url);
  }, [pathname, defaults, excludeSet]);

  // On mount, sync initial URL state
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
    }
  }, []);

  const setFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const setMultiple = useCallback((updates: Partial<T>) => {
    setFilters(prev => {
      const next = { ...prev, ...updates };
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const clearAll = useCallback(() => {
    const cleared = { ...defaults };
    setFilters(cleared);
    syncToUrl(cleared);
  }, [defaults, syncToUrl]);

  return { filters, setFilter, setMultiple, clearAll } as const;
}
