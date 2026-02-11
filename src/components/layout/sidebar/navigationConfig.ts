import type { NavSection } from './config/types';
import {
  mainSection,
  projectSection,
  maintenanceSection,
  peopleSection,
  clientsSection,
  procurementSection,
  contractorsSection,
  assetsSection,
  fleetSection,
  analyticsSection,
  communicationsSection,
  activateSection,
  fieldOperationsSection,
  systemSection,
} from './config';

export const navItems: NavSection[] = [
  mainSection,            // 1. MAIN - Dashboard, Meetings, Action Items
  projectSection,         // 2. PROJECT MANAGEMENT - Projects, Clients, Contractors
  activateSection,        // 3. ACTIVATE - QA review of field work
  maintenanceSection,     // 4. NOC - Network Operations Centre
  procurementSection,     // 5. PROCUREMENT - Materials for projects
  assetsSection,          // 6. ASSETS - Equipment management
  fleetSection,           // 7. FLEET - Vehicles for field ops
  peopleSection,          // 8. HUMAN RESOURCES - Staff
  analyticsSection,       // 9. ANALYTICS - Performance metrics
  communicationsSection,  // 10. COMMUNICATIONS - WhatsApp, meetings
  fieldOperationsSection, // 11. FIELD OPERATIONS - Field App, QField QA, WA Monitor
  systemSection,          // 12. SYSTEM - Admin tools (always last)
  // contractorsSection - MOVED to projectSection
  // clientsSection - MOVED to projectSection
];