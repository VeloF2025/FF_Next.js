import type { NavSection } from './config/types';
import {
  mainSection,
  projectSection,
  nocSection,
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
  conduitSection,
  trackerSection,
  systemSection,
} from './config';

export const navItems: NavSection[] = [
  mainSection,            // 1. MAIN - Dashboard, Meetings, Action Items
  projectSection,         // 2. PROJECT MANAGEMENT - Projects, Clients, Contractors
  activateSection,        // 3. ACTIVATE - QA review of field work
  nocSection,             // 4. NOC - Network Operations Centre
  procurementSection,     // 5. PROCUREMENT - Materials for projects
  accountingSection,      // 6. ACCOUNTING - GL, Journal Entries, Reports
  assetsSection,          // 7. ASSETS - Equipment management
  fleetSection,           // 8. FLEET - Vehicles for field ops
  peopleSection,          // 9. HUMAN RESOURCES - Staff
  fieldOperationsSection, // 10. FIELD OPERATIONS - Civil QA
  conduitSection,         // 11. CONDUIT - Project financial scoping
  trackerSection,         // 12. PON TRACKER - Editable project tracker
  analyticsSection,       // 13. ANALYTICS - Performance metrics
  communicationsSection,  // 14. COMMUNICATIONS - WhatsApp, meetings
  systemSection,          // 15. SYSTEM - Admin tools (always last)
];
