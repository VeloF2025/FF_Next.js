/**
 * Route Types for Tab-Based Navigation
 * Core type definitions for module navigation configuration
 */

import type { LucideIcon } from 'lucide-react';

/**
 * Module identifiers for all FibreFlow modules
 */
export type ModuleId =
  | 'main'
  | 'projects'
  | 'activate'
  | 'noc'
  | 'procurement'
  | 'assets'
  | 'fleet'
  | 'staff'
  | 'people'
  | 'analytics'
  | 'communications'
  | 'system'
  | 'construction-qa';

/**
 * Badge types for tabs
 */
export type BadgeType = 'info' | 'warning' | 'error' | 'success';

/**
 * Tab badge configuration
 */
export interface TabBadge {
  count: number;
  type: BadgeType;
}

/**
 * Single tab configuration
 */
export interface TabConfig {
  /** Unique tab identifier */
  id: string;
  /** Display label */
  label: string;
  /** Short label for mobile/compact views */
  shortLabel?: string;
  /** Tab icon */
  icon: LucideIcon;
  /** Route path (absolute) */
  path: string;
  /** RBAC permission key for access control */
  rbacKey?: string;
  /** Nested sub-tabs (3rd level navigation) */
  subTabs?: TabConfig[];
  /** Optional badge */
  badge?: TabBadge;
  /** Hide tab from navigation */
  hidden?: boolean;
  /** Tab requires context (e.g., selected project) */
  requiresContext?: boolean;
  /** Opens in external page/tab */
  external?: boolean;
}

/**
 * Module navigation configuration
 */
export interface ModuleNavigationConfig {
  /** Unique module identifier */
  moduleId: ModuleId;
  /** Display name */
  moduleName: string;
  /** Optional description/subtitle */
  description?: string;
  /** Base path for the module */
  basePath: string;
  /** Module icon */
  icon: LucideIcon;
  /** Tab configurations */
  tabs: TabConfig[];
  /** Accent color (CSS variable name without --) */
  accentColor?: string;
  /** Show project selector in header */
  showProjectSelector?: boolean;
}
