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
import { nocConfig } from '@/modules/navigation';
import { TicketList } from '@/modules/noc/components/TicketList/TicketList';
import { TicketGridView } from '@/modules/noc/components/TicketList/TicketGridView';
import { KanbanBoard } from '@/modules/noc/components/KanbanBoard';
import { useMyTeams } from '@/modules/noc/hooks/useMyTeams';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { Search, Users, User, Filter, X, Calendar } from 'lucide-react';
import { TicketSummaryTiles } from '@/modules/noc/components/TicketList/TicketSummaryTiles';
import { useProjects } from '@/hooks/useProjects';
import type { TicketFilters } from '@/modules/noc/types/ticket';

type ViewMode = 'table' | 'kanban' | 'grid';
type TicketScope = 'all' | 'my_tickets' | 'my_team';

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

const GridIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h18M3 9h18M3 13h18M3 17h18M8 5v14M16 5v14" />
  </svg>
);

export default function TicketsListPageClient() {
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [ticketScope, setTicketScope] = useState<TicketScope>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterDatePreset, setFilterDatePreset] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const { teamIds } = useMyTeams();
  const { currentUser } = useAuth();
  const { data: projects = [] } = useProjects();
  const activeProjects = (projects as { id: string; name: string; code?: string; status?: string }[])
    .filter((p) => p.status === 'active' || p.status === 'in_progress')
    .sort((a, b) => a.name.localeCompare(b.name));

  // Read status filter from URL params (Active/Completed sub-tabs)
  const statusFilter = searchParams?.get('status') || undefined;

  // Load saved preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ticketsViewMode') as ViewMode | null;
    if (saved && (saved === 'table' || saved === 'kanban' || saved === 'grid')) {
      setViewMode(saved);
    }
    const savedScope = localStorage.getItem('ticketsScope') as TicketScope | null;
    if (savedScope && (savedScope === 'all' || savedScope === 'my_tickets' || savedScope === 'my_team')) {
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

  // Compute date range from preset
  const dateRange = useMemo(() => {
    if (!filterDatePreset) return {};
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filterDatePreset === 'today') {
      return { created_after: startOfDay };
    }
    if (filterDatePreset === 'yesterday') {
      const yesterday = new Date(startOfDay);
      yesterday.setDate(yesterday.getDate() - 1);
      return { created_after: yesterday, created_before: startOfDay };
    }
    if (filterDatePreset === '7d') {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - 7);
      return { created_after: d };
    }
    if (filterDatePreset === '30d') {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - 30);
      return { created_after: d };
    }
    return {};
  }, [filterDatePreset]);

  // Create filters object for components (include status from URL sub-tabs)
  const filters: TicketFilters = useMemo(() => {
    const f: TicketFilters = {
      search: searchTerm || undefined,
      status: statusFilter as any,
      ticket_type: (filterType || undefined) as any,
      source: (filterSource || undefined) as any,
      project_id: filterProject || undefined,
      assigned_to: ticketScope === 'my_tickets' && currentUser?.id ? currentUser.id : undefined,
      assigned_team_id: ticketScope === 'my_team' ? (teamIds.length > 0 ? teamIds[0] : '00000000-0000-0000-0000-000000000000') : undefined,
    };
    if (dateRange.created_after) f.created_after = dateRange.created_after;
    if (dateRange.created_before) f.created_before = dateRange.created_before;
    return f;
  }, [searchTerm, statusFilter, filterType, filterSource, filterProject, ticketScope, teamIds, currentUser?.id, dateRange]);

  const hasActiveFilters = filterType || filterSource || filterDatePreset || filterProject;

  return (
    <ModulePage config={nocConfig} hideHeader>
      <div className="flex flex-col h-full">
        {/* Toolbar: Scope toggle, Search, View toggle, Create */}
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Ticket Scope Toggle */}
            <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1 shrink-0">
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
                onClick={() => handleScopeChange('my_tickets')}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${ticketScope === 'my_tickets'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
                  }
                `}
              >
                <User className="w-3.5 h-3.5" />
                My Tickets
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
                My Team
              </button>
            </div>

            {/* Search Bar */}
            {(viewMode === 'kanban' || viewMode === 'grid') && (
              <div className="relative max-w-md flex-1">
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
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Type & Source Filters */}
            <div className="flex items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors
                  ${filterType
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                    : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                  }`}
              >
                <option value="">All Types</option>
                <option value="fault_repair">Fault Repair</option>
                <option value="new_installation">New Installation</option>
                <option value="modification">Modification</option>
                <option value="ont_swap">ONT Swap</option>
                <option value="pre_provision">Pre-Provision</option>
                <option value="serial_mismatch">Serial Mismatch</option>
                <option value="olt_investigation">OLT Investigation</option>
                <option value="incident">Incident</option>
                <option value="hse_incident">HSE Incident</option>
                <option value="hse_near_miss">HSE Near Miss</option>
                <option value="dev_ops">DevOps</option>
              </select>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors
                  ${filterSource
                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                    : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                  }`}
              >
                <option value="">All Sources</option>
                <option value="pp_data">PP Data</option>
                <option value="qcontact">QContact</option>
                <option value="manual">Manual</option>
                <option value="wa_maintenance">WhatsApp</option>
                <option value="weekly_report">Weekly Report</option>
                <option value="construction">Construction</option>
                <option value="olt_mismatch">OLT Mismatch</option>
                <option value="qa_review">QA Review</option>
                <option value="ad_hoc">Ad Hoc</option>
                <option value="dev_ops">DevOps</option>
              </select>
              <select
                value={filterDatePreset}
                onChange={(e) => setFilterDatePreset(e.target.value)}
                className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors
                  ${filterDatePreset
                    ? 'bg-green-500/10 border-green-500/30 text-green-300'
                    : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                  }`}
              >
                <option value="">All Dates</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors max-w-[180px]
                  ${filterProject
                    ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
                    : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                  }`}
              >
                <option value="">All Projects</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ${p.name}` : p.name}
                  </option>
                ))}
              </select>
              {hasActiveFilters && (
                <button
                  onClick={() => { setFilterType(''); setFilterSource(''); setFilterDatePreset(''); setFilterProject(''); }}
                  className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] rounded"
                  title="Clear filters"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
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
              <button
                onClick={() => handleViewChange('grid')}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode === 'grid'
                    ? 'bg-[var(--ff-primary-500)] text-white shadow-sm'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
                  }
                `}
                title="Grid View"
              >
                <GridIcon />
                <span className="hidden sm:inline">Grid</span>
              </button>
            </div>

            {/* Create Ticket Button */}
            <Link
              href="/noc/tickets/new"
              className="px-4 py-2 bg-[var(--ff-primary-500)] text-white rounded-lg hover:bg-[var(--ff-primary-600)] transition-colors text-sm font-medium"
            >
              Create Ticket
            </Link>
          </div>
        </div>

        {/* Summary Tiles — reactive to current filters */}
        <TicketSummaryTiles filters={filters} />

        {/* View Content */}
        <div className="flex-1">
          {viewMode === 'table' ? (
            <TicketList initialFilters={filters} />
          ) : viewMode === 'grid' ? (
            <TicketGridView initialFilters={filters} />
          ) : (
            <KanbanBoard filters={filters} />
          )}
        </div>
      </div>
    </ModulePage>
  );
}
