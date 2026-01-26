/**
 * Navigation Module - Public API
 *
 * Tab-based navigation system for FibreFlow modules.
 *
 * @example
 * ```tsx
 * import { ModulePage } from '@/components/module-page';
 * import { maintenanceConfig } from '@/modules/navigation';
 *
 * export default function MaintenancePage() {
 *   return (
 *     <ModulePage config={maintenanceConfig}>
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
  maintenanceConfig,
} from './config';
