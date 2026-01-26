'use client';

/**
 * Ticketing Dashboard Page Client Component
 *
 * Displays maintenance module dashboard with:
 * - Summary statistics (open, in progress, closed tickets)
 * - SLA compliance metrics
 * - Workload distribution by assignee
 * - Recent tickets
 * - Escalation alerts
 *
 * 🟢 WORKING: Dashboard page integrates TicketingDashboard component
 */

import { ModulePage } from '@/components/module-page';
import { maintenanceConfig } from '@/modules/navigation';
import { TicketingDashboard } from '@/modules/maintenance/components/Dashboard/TicketingDashboard';

export default function TicketingPageClient() {
  return (
    <ModulePage config={maintenanceConfig}>
      <TicketingDashboard />
    </ModulePage>
  );
}
