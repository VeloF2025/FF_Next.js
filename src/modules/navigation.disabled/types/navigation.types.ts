/**
 * Navigation Context Types
 * Defines state and context interfaces for navigation management
 */

import type { ModuleId, ModuleNavigationConfig, TabConfig, TabBadge } from './route.types';

/**
 * Global navigation state
 */
export interface NavigationState {
  /** Current module ID */
  activeModule: ModuleId | null;
  /** Current route path */
  currentPath: string;
  /** Active tab ID within module */
  activeTab: string | null;
  /** Active sub-tab ID */
  activeSubTab: string | null;
  /** Resolved navigation config for current route */
  currentConfig: ModuleNavigationConfig | null;
}

/**
 * Navigation context value
 */
export interface NavigationContextValue extends NavigationState {
  /** Get config for a specific module */
  getModuleConfig: (moduleId: ModuleId) => ModuleNavigationConfig | undefined;
  /** Get tabs for current route */
  getCurrentTabs: () => TabConfig[];
  /** Get sub-tabs for current tab */
  getCurrentSubTabs: () => TabConfig[];
  /** Navigate to a tab */
  navigateToTab: (tabId: string) => void;
  /** Navigate to a sub-tab */
  navigateToSubTab: (subTabId: string) => void;
  /** Tab badges registry (overrides static badges in config) */
  tabBadges: Record<string, TabBadge>;
  /** Update a tab badge */
  setTabBadge: (tabId: string, badge: TabBadge | undefined) => void;
  /** Check if user has permission for a route */
  hasPermission: (rbacKey?: string) => boolean;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Props for NavigationProvider
 */
export interface NavigationProviderProps {
  children: React.ReactNode;
}
