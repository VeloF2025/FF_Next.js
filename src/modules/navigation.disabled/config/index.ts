/**
 * Navigation Config - Public exports
 */

import {
  registerModuleConfig,
  getModuleConfig,
  getModuleConfigByPath,
  getAllModuleConfigs,
  getActiveTabByPath,
  getActiveSubTabByPath,
  hasConfigs,
  clearRegistry,
} from './registry';

// Module configs - import and register
import { maintenanceConfig } from './modules/maintenance.config';

// Auto-register all module configs
registerModuleConfig(maintenanceConfig);

// Re-export everything
export {
  registerModuleConfig,
  getModuleConfig,
  getModuleConfigByPath,
  getAllModuleConfigs,
  getActiveTabByPath,
  getActiveSubTabByPath,
  hasConfigs,
  clearRegistry,
  maintenanceConfig,
};
