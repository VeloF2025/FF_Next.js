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

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModulePage } from '@/components/module-page';
import { maintenanceConfig } from '@/modules/navigation';
import { TicketList } from '@/modules/maintenance/components/TicketList/TicketList';
import { KanbanBoard } from '@/modules/maintenance/components/KanbanBoard';
import { useMyTeams } from '@/modules/maintenance/hooks/useMyTeams';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import type { TicketFilters } from '@/modules/maintenance/types/ticket';

type ViewMode = 'table' | 'kanban';
type TicketScope = 'all' | 'my_team';

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
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [ticketScope, setTicketScope] = useState<TicketScope>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { teamIds } = useMyTeams();

  // Read status filter from URL params (Active/Completed sub-tabs)
  const statusFilter = searchParams?.get('status') || undefined;

  // Load saved preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ticketsViewMode') as ViewMode | null;
    if (saved && (saved === 'table' || saved === 'kanban')) {
      setViewMode(saved);
    }
    const savedScope = localStorage.getItem('ticketsScope') as TicketScope | null;
    if (savedScope && (savedScope === 'all' || savedScope === 'my_team')) {
      setTicketScope(savedScope);
    }
  }, []);

  // Save preference to localStorage
  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('ticketsViewMode', mode);
  };

  const handleScopeChange = (scope: TicketScope) => {
    setTicketScope(scope);
    localStorage.setItem('ticketsScope', scope);
  };

  // Create filters object for components (include status from URL sub-tabs)
  const filters: TicketFilters = useMemo(() => ({
    search: searchTerm || undefined,
    status: statusFilter as any,
    assigned_team_id: ticketScope === 'my_team' && teamIds.length > 0 ? teamIds[0] : undefined,
  }), [searchTerm, statusFilter, ticketScope, teamIds]);

  // Header actions for ModulePage
  const headerActions = (
    <div className="flex items-center gap-4">
      {/* Ticket Scope Toggle */}
      <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1">
        <button
          onClick={() => handleScopeChange('all')}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
            ${ticketScope === 'all'
              ? 'bg-[var(--ff-primary-500)] text-white shadow-sm'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
            }
          `}
        >
          All Tickets
        </button>
        <button
          onClick={() => handleScopeChange('my_team')}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
            ${ticketScope === 'my_team'
              ? 'bg-purple-500 text-white shadow-sm'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
            }
          `}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">My Team</span>
        </button>
      </div>

      {/* View Toggle */}
      <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1">
        <button
          onClick={() => handleViewChange('table')}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all
            ${viewMode === 'table'
              ? 'bg-[var(--ff-primary-500)] text-white shadow-sm'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
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
              ? 'bg-[var(--ff-primary-500)] text-white shadow-sm'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
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
        href="/maintenance/tickets/new"
        className="px-6 py-2 bg-[var(--ff-primary-500)] text-white rounded-lg hover:bg-[var(--ff-primary-600)] transition-colors"
      >
        Create Ticket
      </Link>
    </div>
  );

  return (
    <ModulePage config={maintenanceConfig} headerActions={headerActions} hideHeader>
      <div className="flex flex-col h-full">
        {/* Search Bar - only show in Kanban view (Table view has built-in search) */}
        {viewMode === 'kanban' && (
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search tickets by ID, DR number, or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]/50"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {/* View Content */}
        <div className="flex-1">
          {viewMode === 'table' ? (
            <TicketList initialFilters={filters} />
          ) : (
            <KanbanBoard filters={filters} />
          )}
        </div>
      </div>
    </ModulePage>
  );
}
