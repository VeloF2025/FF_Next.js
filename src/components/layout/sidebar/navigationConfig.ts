import type { NavSection } from './config/types';
import {
  mainSection,
  projectSection,
  maintenanceSection,
  peopleSection,
  clientsSection,
  procurementSection,
  accountingSection,
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
  accountingSection,      // 6. ACCOUNTING - GL, Journal Entries, Reports
  assetsSection,          // 7. ASSETS - Equipment management
  fleetSection,           // 8. FLEET - Vehicles for field ops
  peopleSection,          // 9. HUMAN RESOURCES - Staff
  analyticsSection,       // 10. ANALYTICS - Performance metrics
  communicationsSection,  // 11. COMMUNICATIONS - WhatsApp, meetings
  fieldOperationsSection, // 12. FIELD OPERATIONS - Field App, QField QA, WA Monitor
  systemSection,          // 13. SYSTEM - Admin tools (always last)
  // contractorsSection - MOVED to projectSection
  // clientsSection - MOVED to projectSection
];