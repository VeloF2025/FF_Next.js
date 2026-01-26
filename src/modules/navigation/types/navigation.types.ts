/**
 * Navigation State Types
 * Types for navigation context and state management
 */

import type { ModuleId, TabBadge } from './route.types';

/**
 * Navigation context state
 */
export interface NavigationState {
  /** Currently active module */
  activeModule: ModuleId | null;
  /** Currently active tab ID */
  activeTab: string | null;
  /** Currently active sub-tab ID */
  activeSubTab: string | null;
  /** Route is loading */
  isLoading: boolean;
}

/**
 * Badge registry - stores dynamic badge counts
 */
export type BadgeRegistry = Record<string, TabBadge>;

/**
 * Navigation context value
 */
export interface NavigationContextValue extends NavigationState {
  /** Update badge for a specific tab */
  setTabBadge: (moduleId: ModuleId, tabId: string, badge: TabBadge | null) => void;
  /** Get all badges for a module */
  getModuleBadges: (moduleId: ModuleId) => BadgeRegistry;
  /** Set loading state */
  setIsLoading: (loading: boolean) => void;
}
