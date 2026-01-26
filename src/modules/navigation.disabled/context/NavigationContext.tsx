/**
 * Navigation Context
 * Provides global navigation state and utilities
 */

'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { useRouter } from 'next/router';
import type {
  NavigationContextValue,
  NavigationProviderProps,
  ModuleId,
  TabConfig,
  TabBadge,
  ModuleNavigationConfig,
} from '../types';
import {
  getModuleConfig,
  getModuleConfigByPath,
  getActiveTabByPath,
  getActiveSubTabByPath,
} from '../config/registry';
import { usePermission } from '@/hooks/usePermission';

const NavigationContext = createContext<NavigationContextValue | undefined>(
  undefined
);

export function NavigationProvider({ children }: NavigationProviderProps) {
  const router = useRouter();
  const { can } = usePermission();
  const [tabBadges, setTabBadges] = useState<Record<string, TabBadge>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Current path from router
  const currentPath = router.pathname;

  // Derive navigation state from current path
  const currentConfig = useMemo(() => {
    return getModuleConfigByPath(currentPath) ?? null;
  }, [currentPath]);

  const activeModule = currentConfig?.moduleId ?? null;

  const activeTab = useMemo(() => {
    if (!currentConfig) return null;
    return getActiveTabByPath(currentConfig, currentPath);
  }, [currentConfig, currentPath]);

  const activeSubTab = useMemo(() => {
    if (!currentConfig || !activeTab) return null;
    return getActiveSubTabByPath(currentConfig, activeTab, router.asPath);
  }, [currentConfig, activeTab, router.asPath]);

  // Get tabs for current route
  const getCurrentTabs = useCallback((): TabConfig[] => {
    return currentConfig?.tabs ?? [];
  }, [currentConfig]);

  // Get sub-tabs for current tab
  const getCurrentSubTabs = useCallback((): TabConfig[] => {
    if (!activeTab || !currentConfig) return [];
    const activeTabConfig = currentConfig.tabs.find((t) => t.id === activeTab);
    return activeTabConfig?.subTabs ?? [];
  }, [activeTab, currentConfig]);

  // Navigate to a tab
  const navigateToTab = useCallback(
    (tabId: string) => {
      const tabConfig = currentConfig?.tabs.find((t) => t.id === tabId);
      if (tabConfig) {
        setIsLoading(true);
        router.push(tabConfig.path).finally(() => setIsLoading(false));
      }
    },
    [currentConfig, router]
  );

  // Navigate to a sub-tab
  const navigateToSubTab = useCallback(
    (subTabId: string) => {
      const currentSubTabs = getCurrentSubTabs();
      const subTabConfig = currentSubTabs.find((st) => st.id === subTabId);
      if (subTabConfig) {
        setIsLoading(true);
        router.push(subTabConfig.path).finally(() => setIsLoading(false));
      }
    },
    [getCurrentSubTabs, router]
  );

  // Update a tab badge
  const setTabBadge = useCallback(
    (tabId: string, badge: TabBadge | undefined) => {
      setTabBadges((prev) => {
        if (badge === undefined) {
          const { [tabId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [tabId]: badge };
      });
    },
    []
  );

  // Check permission for a route
  const hasPermission = useCallback(
    (rbacKey?: string): boolean => {
      if (!rbacKey) return true;
      return can(rbacKey, 'view');
    },
    [can]
  );

  // Handle route change loading state
  useEffect(() => {
    const handleStart = () => setIsLoading(true);
    const handleComplete = () => setIsLoading(false);

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);
    router.events.on('routeChangeError', handleComplete);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
      router.events.off('routeChangeError', handleComplete);
    };
  }, [router.events]);

  const value: NavigationContextValue = useMemo(
    () => ({
      // State
      activeModule,
      currentPath,
      activeTab,
      activeSubTab,
      currentConfig,
      // Methods
      getModuleConfig,
      getCurrentTabs,
      getCurrentSubTabs,
      navigateToTab,
      navigateToSubTab,
      tabBadges,
      setTabBadge,
      hasPermission,
      isLoading,
    }),
    [
      activeModule,
      currentPath,
      activeTab,
      activeSubTab,
      currentConfig,
      getCurrentTabs,
      getCurrentSubTabs,
      navigateToTab,
      navigateToSubTab,
      tabBadges,
      setTabBadge,
      hasPermission,
      isLoading,
    ]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Hook to access navigation context
 */
export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

/**
 * Hook to access navigation context with fallback for pages outside provider
 */
export function useNavigationSafe(): NavigationContextValue | null {
  return useContext(NavigationContext) ?? null;
}

export default NavigationContext;
