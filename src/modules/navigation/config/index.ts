/**
 * Navigation Config - Public Exports
 * Auto-registers all module configs on import
 */

import { registerModuleConfig } from './registry';
import { maintenanceConfig } from './modules/maintenance.config';
import { fleetConfig } from './modules/fleet.config';
import { assetsConfig } from './modules/assets.config';
import { procurementConfig } from './modules/procurement.config';
import { activateConfig } from './modules/activate.config';
import { staffConfig } from './modules/staff.config';

// Register all module configs
registerModuleConfig(maintenanceConfig);
registerModuleConfig(fleetConfig);
registerModuleConfig(assetsConfig);
registerModuleConfig(procurementConfig);
registerModuleConfig(activateConfig);
registerModuleConfig(staffConfig);

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
export { fleetConfig };
export { assetsConfig };
export { procurementConfig };
export { activateConfig };
export { staffConfig };
