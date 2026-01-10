'use client';

/**
 * Ticket List Page Client Component
 *
 * Displays filterable list of all tickets with:
 * - Status, type, assignee, project filters
 * - QA Ready indicator
 * - Fault cause column
 * - Search functionality
 * - Bulk actions
 * - Create new ticket button
 * - Toggle between Table and Kanban views
 *
 * 🟢 WORKING: Ticket list page integrates TicketList and KanbanBoard components
 */

import { useState, useEffect } from 'react';
import { TicketList } from '@/modules/ticketing/components/TicketList/TicketList';
import { KanbanBoard } from '@/modules/ticketing/components/KanbanBoard';
import Link from 'next/link';

type ViewMode = 'table' | 'kanban';

// Icons for view toggle
const TableIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const KanbanIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
  </svg>
);

export default function TicketsListPageClient() {
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  // Load saved preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ticketsViewMode') as ViewMode | null;
    if (saved && (saved === 'table' || saved === 'kanban')) {
      setViewMode(saved);
    }
  }, []);

  // Save preference to localStorage
  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('ticketsViewMode', mode);
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Tickets</h1>
          <p className="text-[var(--ff-text-secondary)]">View and manage all tickets</p>
        </div>
        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex items-center bg-[var(--ff-surface)] border border-[var(--ff-border)] rounded-lg p-1">
            <button
              onClick={() => handleViewChange('table')}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${viewMode === 'table'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg)]'
                }
              `}
              title="Table View"
            >
              <TableIcon />
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              onClick={() => handleViewChange('kanban')}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${viewMode === 'kanban'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg)]'
                }
              `}
              title="Kanban View"
            >
              <KanbanIcon />
              <span className="hidden sm:inline">Kanban</span>
            </button>
          </div>

          {/* Create Ticket Button */}
          <Link
            href="/ticketing/tickets/new"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Ticket
          </Link>
        </div>
      </div>

      {/* View Content */}
      <div className="flex-1">
        {viewMode === 'table' ? <TicketList /> : <KanbanBoard />}
      </div>
    </div>
  );
}
