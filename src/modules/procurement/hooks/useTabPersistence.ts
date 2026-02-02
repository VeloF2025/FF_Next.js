/**
 * Tab Persistence Hook
 * Manages active tab state with localStorage persistence and URL sync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';

interface UseTabPersistenceOptions {
  /** Key prefix for localStorage (e.g., 'sourcing' -> 'procurement_sourcing_tab') */
  pageKey: string;
  /** Default tab to show if no URL param or saved state */
  defaultTab: string;
  /** Valid tab IDs - used to validate URL params */
  validTabs: string[];
}

interface UseTabPersistenceReturn {
  activeTab: string;
  changeTab: (tab: string) => void;
  isInitialized: boolean;
}

/**
 * Hook for managing tab state with persistence
 *
 * Priority:
 * 1. URL query param (?tab=xxx)
 * 2. localStorage saved state
 * 3. Default tab
 *
 * @example
 * const { activeTab, changeTab } = useTabPersistence({
 *   pageKey: 'sourcing',
 *   defaultTab: 'suppliers',
 *   validTabs: ['suppliers', 'boq', 'rfq']
 * });
 */
export function useTabPersistence({
  pageKey,
  defaultTab,
  validTabs,
}: UseTabPersistenceOptions): UseTabPersistenceReturn {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [isInitialized, setIsInitialized] = useState(false);
  const hasInitializedRef = useRef(false);

  const storageKey = `procurement_${pageKey}_tab`;

  // Initialize tab from URL or localStorage
  useEffect(() => {
    if (!router.isReady) return;

    const urlTab = router.query.tab as string | undefined;

    // URL param always takes priority
    if (urlTab && validTabs.includes(urlTab)) {
      setActiveTab(urlTab);
      // Save to localStorage when coming from URL
      try {
        localStorage.setItem(storageKey, urlTab);
      } catch {
        // Ignore localStorage errors
      }
      hasInitializedRef.current = true;
      setIsInitialized(true);
      return;
    }

    // Only use localStorage on first initialization when no URL param
    if (!hasInitializedRef.current) {
      try {
        const savedTab = localStorage.getItem(storageKey);
        if (savedTab && validTabs.includes(savedTab)) {
          setActiveTab(savedTab);
          // Don't replace URL - just set state. User can navigate with tabs.
        } else {
          setActiveTab(defaultTab);
        }
      } catch {
        setActiveTab(defaultTab);
      }
      hasInitializedRef.current = true;
    }

    setIsInitialized(true);
  }, [router.isReady, router.query.tab, validTabs, defaultTab, storageKey]);

  // Change tab handler
  const changeTab = useCallback((tab: string) => {
    if (!validTabs.includes(tab)) {
      log.warn(`Invalid tab "${tab}". Valid tabs: ${validTabs.join(', ')}`, undefined, 'useTabPersistence');
      return;
    }

    setActiveTab(tab);

    // Save to localStorage
    try {
      localStorage.setItem(storageKey, tab);
    } catch {
      // Ignore localStorage errors
    }

    // Update URL (shallow navigation)
    router.push(
      { pathname: router.pathname, query: { ...router.query, tab } },
      undefined,
      { shallow: true }
    );
  }, [validTabs, storageKey, router]);

  return {
    activeTab,
    changeTab,
    isInitialized,
  };
}

export default useTabPersistence;
