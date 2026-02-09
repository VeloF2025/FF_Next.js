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
 *
 * Supports pre-population via URL parameters:
 * - dr_number, source, ticket_type, title, ont_serial, priority, description
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { TicketForm } from '@/modules/maintenance/components/TicketForm';
import type { TicketFormData } from '@/modules/maintenance/hooks/useTicketForm';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/maintenance/types/ticket';

export default function CreateTicketPageClient() {
  const searchParams = useSearchParams();

  // Parse URL parameters into initial form values
  const initialValues = useMemo((): Partial<TicketFormData> | undefined => {
    const values: Partial<TicketFormData> = {};

    const dr_number = searchParams.get('dr_number');
    const source = searchParams.get('source');
    const ticket_type = searchParams.get('ticket_type');
    const title = searchParams.get('title');
    const ont_serial = searchParams.get('ont_serial');
    const priority = searchParams.get('priority');
    const description = searchParams.get('description');

    if (dr_number) values.dr_number = dr_number;
    if (source && Object.values(TicketSource).includes(source as TicketSource)) {
      values.source = source as TicketSource;
    }
    if (ticket_type && Object.values(TicketType).includes(ticket_type as TicketType)) {
      values.ticket_type = ticket_type as TicketType;
    }
    if (title) values.title = title;
    if (ont_serial) values.ont_serial = ont_serial;
    if (priority && Object.values(TicketPriority).includes(priority as TicketPriority)) {
      values.priority = priority as TicketPriority;
    }
    if (description) values.description = description;

    return Object.keys(values).length > 0 ? values : undefined;
  }, [searchParams]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/maintenance/tickets"
          className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
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

      <TicketForm initialValues={initialValues} />
    </div>
  );
}
