/**
 * Navigation Route Types
 * Defines the structure for module navigation configurations
 */

import type { LucideIcon } from 'lucide-react';

/**
 * Module identifier matching sidebar sectionId
 */
export type ModuleId =
  | 'main'
  | 'projects'
  | 'activate'
  | 'noc'
  | 'procurement'
  | 'assets'
  | 'fleet'
  | 'people'
  | 'analytics'
  | 'communications'
  | 'system';

/**
 * Tab badge configuration
 */
export interface TabBadge {
  /** Badge count to display */
  count?: number;
  /** Badge type determines color */
  type?: 'info' | 'warning' | 'error' | 'success';
  /** Pulse animation for attention */
  pulse?: boolean;
}

/**
 * Tab configuration for navigation
 */
export interface TabConfig {
  /** Unique tab identifier */
  id: string;
  /** Display label */
  label: string;
  /** Short label for compact views */
  shortLabel?: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Route path (absolute) */
  path: string;
  /** RBAC permission key for access control */
  rbacKey?: string;
  /** Sub-tabs for 3rd level navigation */
  subTabs?: TabConfig[];
  /** Static badge (can be overridden by context) */
  badge?: TabBadge;
  /** Hide from tab bar but still accessible via URL */
  hidden?: boolean;
  /** Requires context (e.g., project selection) to be enabled */
  requiresContext?: boolean;
  /** External link opens in new tab */
  external?: boolean;
}

/**
 * Complete module navigation configuration
 */
export interface ModuleNavigationConfig {
  /** Module identifier */
  moduleId: ModuleId;
  /** Display name for the module */
  moduleName: string;
  /** Module description/subtitle */
  description?: string;
  /** Base path for this module (e.g., '/noc') */
  basePath: string;
  /** Module icon */
  icon: LucideIcon;
  /** Primary tabs shown below module header */
  tabs: TabConfig[];
  /** Module-level accent color (optional, uses primary by default) */
  accentColor?: string;
  /** Show project selector in header */
  showProjectSelector?: boolean;
}
