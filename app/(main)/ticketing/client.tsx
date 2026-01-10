'use client';

/**
 * Ticketing Dashboard Page Client Component
 *
 * Displays ticketing module dashboard with:
 * - Summary statistics (open, in progress, closed tickets)
 * - SLA compliance metrics
 * - Workload distribution by assignee
 * - Recent tickets
 * - Escalation alerts
 *
 * 🟢 WORKING: Dashboard page integrates TicketingDashboard component
 */

import { TicketingDashboard } from '@/modules/ticketing/components/Dashboard/TicketingDashboard';

export default function TicketingPageClient() {
  return (
    <div className="p-6">
      <TicketingDashboard />
    </div>
  );
}
