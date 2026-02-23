/**
 * useModuleTabs Hook
 * Manages tab state and navigation for module pages
 */

'use client';

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { usePermission } from '@/hooks/usePermission';
import { getActiveTabByPath, getActiveSubTabByPath } from '../config/registry';
import type { ModuleNavigationConfig, TabConfig, TabBadge } from '../types';

interface UseModuleTabsOptions {
  /** Module navigation configuration */
  config: ModuleNavigationConfig;
  /** Tab badges (overrides static config badges) */
  tabBadges?: Record<string, TabBadge>;
}

interface UseModuleTabsReturn {
  /** Currently active tab */
  activeTab: string | null;
  /** Currently active sub-tab */
  activeSubTab: string | null;
  /** Visible tabs (filtered by permissions) */
  visibleTabs: TabConfig[];
  /** Sub-tabs of the current active tab */
  currentSubTabs: TabConfig[];
  /** Handle tab click */
  handleTabClick: (tab: TabConfig) => void;
  /** Handle sub-tab click */
  handleSubTabClick: (subTab: TabConfig) => void;
  /** Check if user has permission for a tab */
  hasPermission: (rbacKey: string) => boolean;
  /** Is route currently loading */
  isLoading: boolean;
}

export function useModuleTabs({
  config,
  tabBadges = {},
}: UseModuleTabsOptions): UseModuleTabsReturn {
  const router = useRouter();
  const { can } = usePermission();

  // Construct full path with query params
  const fullPath = useMemo(() => {
    const pathname = router.asPath.split('?')[0] || '';
    const search = router.asPath.includes('?') ? router.asPath.split('?')[1] : '';
    return search ? `${pathname}?${search}` : pathname;
  }, [router.asPath]);

  // Determine active tab from current URL
  const activeTabConfig = useMemo(() => {
    return getActiveTabByPath(config, fullPath);
  }, [config, fullPath]);

  // Determine active sub-tab from current URL
  const activeSubTabConfig = useMemo(() => {
    if (!activeTabConfig) return undefined;
    return getActiveSubTabByPath(activeTabConfig, fullPath);
  }, [activeTabConfig, fullPath]);

  // Filter tabs by visibility and permissions
  const visibleTabs = useMemo(() => {
    return config.tabs.filter((tab) => {
      // Hidden tabs are never shown
      if (tab.hidden) return false;
      // All other tabs are shown (locked state handled in UI)
      return true;
    });
  }, [config.tabs]);

  // Get sub-tabs for the active tab
  const currentSubTabs = useMemo(() => {
    return activeTabConfig?.subTabs || [];
  }, [activeTabConfig]);

  // Handle tab navigation
  const handleTabClick = useCallback(
    (tab: TabConfig) => {
      // Check permissions
      if (tab.rbacKey && !can(tab.rbacKey, 'view')) {
        return;
      }

      // Navigate to tab path
      router.push(tab.path);
    },
    [router, can]
  );

  // Handle sub-tab navigation
  const handleSubTabClick = useCallback(
    (subTab: TabConfig) => {
      router.push(subTab.path);
    },
    [router]
  );

  // Permission checker wrapper
  const checkPermission = useCallback(
    (rbacKey: string): boolean => {
      return can(rbacKey, 'view');
    },
    [can]
  );

  return {
    activeTab: activeTabConfig?.id || null,
    activeSubTab: activeSubTabConfig?.id || null,
    visibleTabs,
    currentSubTabs,
    handleTabClick,
    handleSubTabClick,
    hasPermission: checkPermission,
    isLoading: false, // Can be connected to router loading state if needed
  };
}

export default useModuleTabs;
