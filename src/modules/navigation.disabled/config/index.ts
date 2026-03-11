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
import { nocConfig } from './modules/noc.config';

// Auto-register all module configs
registerModuleConfig(nocConfig);

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
  nocConfig,
};
