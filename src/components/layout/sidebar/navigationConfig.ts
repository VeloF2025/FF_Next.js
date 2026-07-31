import type { NavSection } from './config/types';
import {
  mainSection,
  projectSection,
  nocSection,
  peopleSection,
  procurementSection,
  planningSection,
  // accountingSection,   // DECOMMISSIONED 2026-04-01 — module disabled, routes blocked in middleware
  // clientsSection,      // merged into projectSection
  // contractorsSection,  // merged into projectSection
  assetsSection,
  fleetSection,
  analyticsSection,
  communicationsSection,
  activateSection,
  fieldOperationsSection,
  healthSafetySection,
  conduitSection,
  trackerSection,
  systemSection,
  cortexSection,
} from './config';

export const navItems: NavSection[] = [
  mainSection,            // 1. MAIN - Dashboard, Meetings, Action Items
  projectSection,         // 2. PROJECT MANAGEMENT - Projects, Clients, Contractors
  activateSection,        // 3. ACTIVATE - QA review of field work
  nocSection,             // 4. NOC - Network Operations Centre
  procurementSection,     // 5. PROCUREMENT - Materials for projects
  planningSection,        // 6. PLANNING - Project planning and kanban
  // accountingSection,   // ACCOUNTING - DECOMMISSIONED 2026-04-01
  assetsSection,          // 7. ASSETS - Equipment management
  fleetSection,           // 8. FLEET - Vehicles for field ops
  peopleSection,          // 9. HUMAN RESOURCES - Staff
  fieldOperationsSection, // 10. FIELD OPERATIONS - Civil QA
  healthSafetySection,    // 11. HEALTH & SAFETY - moved out of Projects 2026-07-31
  conduitSection,         // 12. CONDUIT - Project financial scoping
  trackerSection,         // 13. PON TRACKER - Editable project tracker
  analyticsSection,       // 14. ANALYTICS - Performance metrics
  communicationsSection,  // 15. COMMUNICATIONS - WhatsApp, meetings
  cortexSection,          // 16. CORTEX - AI enrichment review
  systemSection,          // 17. SYSTEM - Admin tools (always last)
];
