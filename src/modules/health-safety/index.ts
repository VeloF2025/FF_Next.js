/**
 * Health & Safety Module
 *
 * Comprehensive H&S management for FibreFlow including:
 * - Project H&S configuration and audits
 * - Contractor H&S compliance and gate checking
 * - Integration with maintenance ticketing for incidents
 * - SA regulatory compliance (OHS Act, Construction Regulations)
 *
 * @module health-safety
 */

// Types
export * from './types';

// Constants
export * from './constants/sa-regulations';

// Services
export { calculateContractorHSScore } from './services/scoringService';
export { checkContractorGate } from './services/gateService';
export {
  batchCheckGate,
  quickGateCheck,
  getBlockedContractors,
} from './services/gateQueries';

// Components
export { ProjectHSTab, AuditWizard } from './components';
