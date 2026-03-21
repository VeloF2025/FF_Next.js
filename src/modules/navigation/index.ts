/**
 * Navigation Module - Public API
 *
 * Tab-based navigation system for FibreFlow modules.
 *
 * @example
 * ```tsx
 * import { ModulePage } from '@/components/module-page';
 * import { nocConfig } from '@/modules/navigation';
 *
 * export default function MaintenancePage() {
 *   return (
 *     <ModulePage config={nocConfig}>
 *       <MaintenanceDashboard />
 *     </ModulePage>
 *   );
 * }
 * ```
 */

// Types
export type {
  ModuleId,
  BadgeType,
  TabBadge,
  TabConfig,
  ModuleNavigationConfig,
  NavigationState,
  BadgeRegistry,
  NavigationContextValue,
} from './types';

// Components
export { ModuleTabs, SubTabs } from './components';

// Hooks
export { useModuleTabs } from './hooks';

// Config & Registry
export {
  registerModuleConfig,
  getModuleConfig,
  getAllModuleConfigs,
  getModuleConfigByPath,
  getActiveTabByPath,
  getActiveSubTabByPath,
  nocConfig,
  fleetConfig,
  assetsConfig,
  procurementConfig,
  activateConfig,
  staffConfig,
  projectsConfig,
  constructionQaConfig,
  analyticsConfig,
} from './config';
