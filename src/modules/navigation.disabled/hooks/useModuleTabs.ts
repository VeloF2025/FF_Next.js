/**
 * useModuleTabs Hook
 * Provides tab state and utilities for module pages
 */

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { ModuleNavigationConfig, TabConfig, TabBadge } from '../types';
import { getActiveTabByPath, getActiveSubTabByPath } from '../config/registry';
import { usePermission } from '@/hooks/usePermission';

interface UseModuleTabsOptions {
  /** Module configuration */
  config: ModuleNavigationConfig;
  /** External tab badges */
  tabBadges?: Record<string, TabBadge>;
  /** Controlled active tab (overrides URL-based detection) */
  controlledActiveTab?: string;
  /** Called when tab changes */
  onTabChange?: (tabId: string) => void;
}

interface UseModuleTabsReturn {
  /** Currently active tab ID */
  activeTab: string | null;
  /** Currently active sub-tab ID */
  activeSubTab: string | null;
  /** Visible tabs (with badges merged) */
  visibleTabs: TabConfig[];
  /** Current tab configuration */
  currentTabConfig: TabConfig | undefined;
  /** Current sub-tabs */
  currentSubTabs: TabConfig[];
  /** Navigate to tab */
  handleTabClick: (tab: TabConfig) => void;
  /** Navigate to sub-tab */
  handleSubTabClick: (subTab: TabConfig) => void;
  /** Check permission for tab */
  hasPermission: (rbacKey?: string) => boolean;
  /** Loading state */
  isNavigating: boolean;
}

export function useModuleTabs({
  config,
  tabBadges = {},
  controlledActiveTab,
  onTabChange,
}: UseModuleTabsOptions): UseModuleTabsReturn {
  const router = useRouter();
  const { can } = usePermission();

  // Determine active tab from URL or controlled prop
  const activeTab = useMemo(() => {
    if (controlledActiveTab) return controlledActiveTab;
    return getActiveTabByPath(config, router.pathname);
  }, [config, router.pathname, controlledActiveTab]);

  // Determine active sub-tab
  const activeSubTab = useMemo(() => {
    if (!activeTab) return null;
    return getActiveSubTabByPath(config, activeTab, router.asPath);
  }, [config, activeTab, router.asPath]);

  // Get current tab config
  const currentTabConfig = useMemo(() => {
    return config.tabs.find((t) => t.id === activeTab);
  }, [config.tabs, activeTab]);

  // Get current sub-tabs
  const currentSubTabs = useMemo(() => {
    return currentTabConfig?.subTabs ?? [];
  }, [currentTabConfig]);

  // Filter visible tabs and merge badges
  const visibleTabs = useMemo(() => {
    return config.tabs
      .filter((tab) => !tab.hidden)
      .map((tab) => ({
        ...tab,
        badge: tabBadges[tab.id] ?? tab.badge,
      }));
  }, [config.tabs, tabBadges]);

  // Permission check
  const hasPermission = useCallback(
    (rbacKey?: string): boolean => {
      if (!rbacKey) return true;
      return can(rbacKey, 'view');
    },
    [can]
  );

  // Handle tab click
  const handleTabClick = useCallback(
    (tab: TabConfig) => {
      if (!hasPermission(tab.rbacKey)) return;

      if (onTabChange) {
        onTabChange(tab.id);
      }

      if (tab.external) {
        window.open(tab.path, '_blank');
      } else {
        router.push(tab.path);
      }
    },
    [hasPermission, onTabChange, router]
  );

  // Handle sub-tab click
  const handleSubTabClick = useCallback(
    (subTab: TabConfig) => {
      router.push(subTab.path);
    },
    [router]
  );

  return {
    activeTab,
    activeSubTab,
    visibleTabs,
    currentTabConfig,
    currentSubTabs,
    handleTabClick,
    handleSubTabClick,
    hasPermission,
    isNavigating: false, // Could track with router events
  };
}

export default useModuleTabs;
