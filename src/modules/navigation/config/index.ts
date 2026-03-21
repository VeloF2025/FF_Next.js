/**
 * Navigation Config - Public Exports
 * Auto-registers all module configs on import
 */

import { registerModuleConfig } from './registry';
import { nocConfig } from './modules/noc.config';
import { fleetConfig } from './modules/fleet.config';
import { assetsConfig } from './modules/assets.config';
import { procurementConfig } from './modules/procurement.config';
import { activateConfig } from './modules/activate.config';
import { staffConfig } from './modules/staff.config';
import { projectsConfig } from './modules/projects.config';
import { constructionQaConfig } from './modules/construction-qa.config';
import { analyticsConfig } from './modules/analytics.config';

// Register all module configs
registerModuleConfig(nocConfig);
registerModuleConfig(fleetConfig);
registerModuleConfig(assetsConfig);
registerModuleConfig(procurementConfig);
registerModuleConfig(activateConfig);
registerModuleConfig(staffConfig);
registerModuleConfig(projectsConfig);
registerModuleConfig(constructionQaConfig);
registerModuleConfig(analyticsConfig);

// Re-export everything
export {
  registerModuleConfig,
  getModuleConfig,
  getAllModuleConfigs,
  getModuleConfigByPath,
  getActiveTabByPath,
  getActiveSubTabByPath,
} from './registry';

export { nocConfig };
export { fleetConfig };
export { assetsConfig };
export { procurementConfig };
export { activateConfig };
export { staffConfig };
export { projectsConfig };
export { constructionQaConfig };
