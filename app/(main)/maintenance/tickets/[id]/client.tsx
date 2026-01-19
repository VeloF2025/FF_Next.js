'use client';

/**
 * Ticket Detail Page Client Component
 *
 * Displays full ticket information including:
 * - Ticket header with status and key info
 * - Verification checklist (12-step workflow)
 * - QA Readiness panel
 * - Risk acceptance section
 * - Fault attribution selector
 * - Handover history
 * - Timeline/activity log
 * - Attachments
 * - Notes
 *
 * 🟢 WORKING: Ticket detail page integrates TicketDetail component
 */

import { TicketDetail } from '@/modules/ticketing/components/TicketDetail/TicketDetail';
import { useParams } from 'next/navigation';

export default function TicketDetailPageClient() {
  const params = useParams();
  const ticketId = params.id as string;

  return (
    <div className="p-6">
      <TicketDetail ticketId={ticketId} />
    </div>
  );
}
