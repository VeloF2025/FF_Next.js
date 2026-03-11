/**
 * Navigation Module - Public exports
 *
 * Provides centralized navigation management for FibreFlow modules
 * with tab-based navigation, sub-tabs, badges, and permission control.
 *
 * @example
 * ```tsx
 * // In _app.tsx
 * import { NavigationProvider } from '@/modules/navigation';
 *
 * // In module pages
 * import { useNavigation, ModuleTabs, SubTabs } from '@/modules/navigation';
 * import { nocConfig } from '@/modules/navigation';
 * ```
 */

// Types
export type {
  ModuleId,
  TabBadge,
  TabConfig,
  ModuleNavigationConfig,
  NavigationState,
  NavigationContextValue,
  NavigationProviderProps,
} from './types';

// Context & Provider
export {
  NavigationProvider,
  useNavigation,
  useNavigationSafe,
} from './context';

// Components
export { ModuleTabs, SubTabs } from './components';

// Hooks
export { useModuleTabs } from './hooks';

// Config & Registry
export {
  registerModuleConfig,
  getModuleConfig,
  getModuleConfigByPath,
  getAllModuleConfigs,
  getActiveTabByPath,
  getActiveSubTabByPath,
  nocConfig,
} from './config';
