/**
 * Navigation Config - Public Exports
 * Auto-registers all module configs on import
 */

import { registerModuleConfig } from './registry';
import { maintenanceConfig } from './modules/maintenance.config';

// Register all module configs
registerModuleConfig(maintenanceConfig);

// Re-export everything
export {
  registerModuleConfig,
  getModuleConfig,
  getAllModuleConfigs,
  getModuleConfigByPath,
  getActiveTabByPath,
  getActiveSubTabByPath,
} from './registry';

export { maintenanceConfig };
