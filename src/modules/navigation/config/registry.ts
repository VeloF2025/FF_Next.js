/**
 * Navigation Module Registry
 * Central registry for all module navigation configurations
 */

import type { ModuleId, ModuleNavigationConfig, TabConfig } from '../types';

/** Module configuration registry */
const moduleRegistry = new Map<ModuleId, ModuleNavigationConfig>();

/**
 * Register a module configuration
 */
export function registerModuleConfig(config: ModuleNavigationConfig): void {
  moduleRegistry.set(config.moduleId, config);
}

/**
 * Get module configuration by ID
 */
export function getModuleConfig(moduleId: ModuleId): ModuleNavigationConfig | undefined {
  return moduleRegistry.get(moduleId);
}

/**
 * Get all registered modules
 */
export function getAllModuleConfigs(): ModuleNavigationConfig[] {
  return Array.from(moduleRegistry.values());
}

/**
 * Get module configuration by path (matches basePath or any tab path)
 */
export function getModuleConfigByPath(path: string): ModuleNavigationConfig | undefined {
  // Normalize path - remove trailing slash, query params
  const normalizedPath = path.split('?')[0]?.replace(/\/$/, '') || '/';

  for (const config of moduleRegistry.values()) {
    // Check base path
    if (normalizedPath === config.basePath || normalizedPath.startsWith(config.basePath + '/')) {
      return config;
    }

    // Check tab paths
    for (const tab of config.tabs) {
      const tabPath = tab.path.split('?')[0]?.replace(/\/$/, '') || '';
      if (normalizedPath === tabPath) {
        return config;
      }
    }
  }

  return undefined;
}

/**
 * Get the active tab for a given path
 */
export function getActiveTabByPath(
  config: ModuleNavigationConfig,
  path: string
): TabConfig | undefined {
  const normalizedPath = path.split('?')[0]?.replace(/\/$/, '') || '/';

  // Check exact matches first
  for (const tab of config.tabs) {
    const tabPath = tab.path.split('?')[0]?.replace(/\/$/, '') || '';
    if (normalizedPath === tabPath) {
      return tab;
    }
  }

  // Check if path starts with tab path (for nested routes)
  for (const tab of config.tabs) {
    const tabPath = tab.path.split('?')[0]?.replace(/\/$/, '') || '';
    if (normalizedPath.startsWith(tabPath + '/')) {
      return tab;
    }
  }

  // Default to first tab if on module base path
  if (normalizedPath === config.basePath) {
    return config.tabs[0];
  }

  return undefined;
}

/**
 * Get the active sub-tab for a given path and parent tab
 */
export function getActiveSubTabByPath(
  tab: TabConfig,
  path: string
): TabConfig | undefined {
  if (!tab.subTabs?.length) return undefined;

  const fullPath = path.split('?')[0] || '';
  const queryString: string = path.includes('?') ? (path.split('?')[1] ?? '') : '';

  // Check for query param matches (e.g., ?status=active)
  for (const subTab of tab.subTabs) {
    const subTabPath = subTab.path;
    if (subTabPath.includes('?')) {
      const subTabQuery = subTabPath.split('?')[1] || '';
      const queryKey = subTabQuery.split('=')[0];
      if (queryKey && queryString.includes(queryKey)) {
        // Check if query values match
        if (queryString === subTabQuery) {
          return subTab;
        }
      }
    }
  }

  // Check path matches
  for (const subTab of tab.subTabs) {
    const subTabPath = subTab.path.split('?')[0] || '';
    if (fullPath === subTabPath || fullPath.startsWith(subTabPath + '/')) {
      return subTab;
    }
  }

  return undefined;
}
