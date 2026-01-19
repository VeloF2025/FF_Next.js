'use client';

/**
 * Create Ticket Page Client Component
 *
 * Allows users to manually create new tickets with:
 * - Ticket source selection (manual, construction, incident, etc.)
 * - DR number lookup from SOW module
 * - Location details (zone, pole, PON)
 * - Equipment information (ONT serial, RX level)
 * - Assignment to technicians/contractors
 * - Priority and SLA settings
 * - Fault cause classification (for maintenance tickets)
 */

import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { TicketForm } from '@/modules/maintenance/components/TicketForm';

export default function CreateTicketPageClient() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/maintenance/tickets"
          className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tickets
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Plus className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Create New Ticket</h1>
            <p className="text-[var(--ff-text-secondary)]">Create a new maintenance record for fiber network issues</p>
          </div>
        </div>
      </div>

      <TicketForm />
    </div>
  );
}
