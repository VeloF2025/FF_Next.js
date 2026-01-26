/**
 * Navigation Registry
 * Central registry for all module navigation configurations
 */

import type { ModuleId, ModuleNavigationConfig } from '../types';

/**
 * Central registry of all module navigation configurations
 * Populated by individual module config files
 */
const navigationRegistry = new Map<ModuleId, ModuleNavigationConfig>();

/**
 * Register a module configuration
 */
export function registerModuleConfig(config: ModuleNavigationConfig): void {
  navigationRegistry.set(config.moduleId, config);
}

/**
 * Get module config by ID
 */
export function getModuleConfig(moduleId: ModuleId): ModuleNavigationConfig | undefined {
  return navigationRegistry.get(moduleId);
}

/**
 * Get module config by path (matches base path or child paths)
 */
export function getModuleConfigByPath(path: string): ModuleNavigationConfig | undefined {
  // Sort by basePath length descending for most specific match
  const configs = Array.from(navigationRegistry.values()).sort(
    (a, b) => b.basePath.length - a.basePath.length
  );

  for (const config of configs) {
    if (path === config.basePath || path.startsWith(config.basePath + '/')) {
      return config;
    }
  }
  return undefined;
}

/**
 * Get all registered module configs
 */
export function getAllModuleConfigs(): ModuleNavigationConfig[] {
  return Array.from(navigationRegistry.values());
}

/**
 * Get active tab for a given path within a module
 */
export function getActiveTabByPath(
  config: ModuleNavigationConfig,
  path: string
): string | null {
  // Sort tabs by path length descending for most specific match
  const sortedTabs = [...config.tabs].sort((a, b) => b.path.length - a.path.length);

  for (const tab of sortedTabs) {
    if (path === tab.path || path.startsWith(tab.path + '/') || path.startsWith(tab.path + '?')) {
      return tab.id;
    }
  }

  // Default to first tab if no match
  return config.tabs[0]?.id ?? null;
}

/**
 * Get active sub-tab for a given path within a tab
 */
export function getActiveSubTabByPath(
  config: ModuleNavigationConfig,
  activeTabId: string,
  path: string
): string | null {
  const activeTab = config.tabs.find((t) => t.id === activeTabId);
  if (!activeTab?.subTabs?.length) return null;

  // Sort sub-tabs by path length descending
  const sortedSubTabs = [...activeTab.subTabs].sort(
    (a, b) => b.path.length - a.path.length
  );

  for (const subTab of sortedSubTabs) {
    if (path === subTab.path || path.startsWith(subTab.path + '/') || path.includes(subTab.path)) {
      return subTab.id;
    }
  }

  // Default to first sub-tab if on parent tab
  return activeTab.subTabs[0]?.id ?? null;
}

/**
 * Check if registry has any configs registered
 */
export function hasConfigs(): boolean {
  return navigationRegistry.size > 0;
}

/**
 * Clear registry (for testing)
 */
export function clearRegistry(): void {
  navigationRegistry.clear();
}
